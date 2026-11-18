"""Compétences de l'assistant : des outils en lecture seule, exécutés côté serveur AVEC LES DROITS de la personne connectée.

L'assistant ne voit que ce que la personne a le droit de voir (mêmes filtres que l'interface : acces.vue, journal.visible),
et ne fait aucune action à sa place (ouvrir un dossier, donner un accord…) : il explique où cliquer.
"""
import asyncio

from acces import vue
from consentement import accords_et_preferences
from journal import lignes, verifier
from journal.api import visible
from passerelle import appels
from passerelle.api import IU_TEST, annuaire, lire as branchements, verifier_identite
from passerelle.appels import appeler
from session import Personne
from stockage import ref

TYPES = {
    "acte_naissance": "Acte de naissance", "certificat_nationalite": "Certificat de nationalité",
    "casier_judiciaire": "Extrait de casier judiciaire", "certificat_residence": "Certificat de résidence",
    "acte_mariage": "Acte de mariage", "photo_identite": "Photo d'identité",
    "majeur": "Majeur : oui/non", "casier_vierge": "Casier judiciaire vierge : oui/non",
}
STATUTS_PIECE = {
    "en_attente": "en attente de l'accord du citoyen", "recherche": "recherche en cours", "a_choisir": "plusieurs pièces trouvées, à préciser au guichet",
    "indisponible": "indisponible (registre en panne)", "sans_source": "aucun registre ne la fournit", "a_fournir": "aucun registre ne la détient, à présenter au guichet",
    "en_file": "envoi en attente (hors ligne)", "fournie": "obtenue", "repondu": "répondu", "refusee": "refusée par le citoyen",
}
ACCORDS = {
    "actif": "accord en vigueur : la passerelle peut échanger les pièces de ce dossier",
    "en_attente": "ancien dossier en attente (cette option n'existe plus)",
    "refuse": "refusé (ancien dossier)", "revoque": "retiré (ancien dossier)", "clos": "terminé (dossier clôturé)",
}
STATUTS_DOSSIER = {
    "en_attente_citoyen": "en attente de l'accord du citoyen", "autorise": "pièces en cours", "complet": "complet",
    "refuse": "refusé par le citoyen", "revoque": "accord retiré", "clos": "clôturé",
}


def _etat(p: Personne) -> dict:
    etat = ref("socle").get() or {}
    if not etat.get("roles"):
        etat["roles"] = [{"id": k, **v} for k, v in ((ref("installation").get() or {}).get("roles") or {}).items()]
    accords, preferences = accords_et_preferences()
    return vue(etat, p, accords, preferences)


def _nom(etat: dict, iu: str) -> str:
    x = (etat.get("personnes") or {}).get(iu) or {}
    return f"{x.get('prenoms', '')} {x.get('nom', '')}".strip() or "personne inconnue"


def _piece(t: str, x: dict) -> dict:
    d = {"piece": TYPES.get(t, t), "etat": STATUTS_PIECE.get(x.get("statut"), x.get("statut"))}
    if x.get("statut") == "repondu":
        d["reponse"] = "inconnu" if x.get("valeur") is None else ("oui" if x.get("valeur") else "non")
    if x.get("provenance") == "service":
        d["transmise_par"] = x.get("nomService") or x.get("source")
    elif x.get("provenance") == "usager":
        d["fournie_par"] = "le citoyen (non certifiée)"
    if x.get("refus"):
        d["refusee_par_le_registre"] = True
    return d


def _dossier(etat: dict, d: dict, detail: bool) -> dict:
    services = etat.get("services") or {}
    sortie = {"numero": d.get("id"), "service": (services.get(d.get("service")) or {}).get("nom", d.get("service")),
              "demarche": d.get("finalite"), "statut": STATUTS_DOSSIER.get(d.get("statut"), d.get("statut")),
              "ouvert_le": (d.get("cree") or "")[:10],
              "accord": ACCORDS.get((d.get("consent") or {}).get("statut"), "inconnu")}
    if detail:
        sortie["base_legale"] = d.get("base_legale")
        sortie["pieces"] = [_piece(t, x) for t, x in (d.get("pieces") or {}).items()]
    return sortie


# ── Compétences ──────────────────────────────────────────────────────────────
async def mes_demandes(p, _):
    etat = _etat(p)
    ds = [d for d in (etat.get("dossiers") or {}).values() if d.get("iu") == p.iu]
    return {"demandes": [_dossier(etat, d, True) for d in sorted(ds, key=lambda d: d.get("cree", ""), reverse=True)]}


async def qui_a_consulte_mes_donnees(p, entree):
    limite = max(1, min(int(entree.get("limite") or 15), 50))
    etat = _etat(p)
    services = etat.get("services") or {}
    sortie = []
    for l in [l for l in lignes() if l.get("iu") == p.iu][-limite:][::-1]:
        qui = ("vous" if l.get("casquette") == "citoyen" and l.get("auteur") == p.iu
               else "la passerelle" if l.get("casquette") == "passerelle" else
               f"{(services.get(l.get('service')) or {}).get('nom', l.get('service') or '')} ({l.get('casquette')} {l.get('code') or ''})".strip())
        sortie.append({"quand": l.get("ts"), "qui": qui, "action": l.get("action"), "objet": l.get("cible"), "detail": l.get("details"),
                       "resultat": l.get("resultat")})
    return {"lignes": sortie, "remarque": "les plus récentes d'abord"}


async def annuaire_des_registres(p, _):
    sortie = []
    for k, f in annuaire().items():
        if not f["branche"]:
            continue
        restreint = [TYPES.get(c, c) for c in f["types"] + f["predicats"] if "*" not in (f["autorisations"].get(c) or ["*"])]
        sortie.append({"registre": f["nom"], "pieces": [TYPES.get(t, t) for t in f["types"]],
                       "reponses_oui_non": [TYPES.get(t, t) for t in f["predicats"]], "acces_restreint_pour": restreint,
                       "verification_identite": f["double_api"]})
    return {"registres_branches": sortie}


async def verifier_integrite_du_journal(p, _):
    r = verifier()
    return {"integre": r["ok"], **({"lignes": r["total"]} if r["ok"] else {"probleme": r.get("raison"), "ligne": r.get("ligne")})}


async def verifier_une_identite(p, entree):
    role = p.role("agent") or p.role("admin") or (p.roles[0] if p.roles else None)
    nin = "".join(str(entree.get("nin", "")).split())
    if not (nin.isdigit() and len(nin) == 17):
        return {"erreur": "Le NIN compte 17 chiffres."}
    r = await verifier_identite(nin, (role or {}).get("service") or "assistant")
    return {"nin": nin, "reconnu": r.get("valide"), **({"nom": r.get("nom"), "prenoms": r.get("prenoms")} if r.get("valide") else {}),
            "rappel": "Vérification inscrite au journal, visible par la personne concernée."}


async def dossiers_du_service(p, entree):
    etat = _etat(p)
    statut = entree.get("statut")
    ds = [d for d in (etat.get("dossiers") or {}).values() if d.get("service") in p.services("agent")]
    if statut:
        ds = [d for d in ds if d.get("statut") == statut]
    ds = sorted(ds, key=lambda d: d.get("cree", ""), reverse=True)[:30]
    return {"dossiers": [{**_dossier(etat, d, False), "citoyen": _nom(etat, d.get("iu"))} for d in ds]}


async def detail_d_un_dossier(p, entree):
    etat = _etat(p)
    numero = str(entree.get("numero", "")).strip().upper()
    d = (etat.get("dossiers") or {}).get(numero)
    if not d or (d.get("service") not in p.services("agent") and d.get("iu") != p.iu):
        return {"erreur": f"Dossier {numero} introuvable ou hors de vos droits."}
    return {**_dossier(etat, d, True), "citoyen": _nom(etat, d.get("iu"))}


async def demarches_du_service(p, _):
    etat = _etat(p)
    sortie = []
    for service, dms in (etat.get("demarches") or {}).items():
        for k, dm in dms.items():
            sortie.append({"service": ((etat.get("services") or {}).get(service) or {}).get("nom", service), "code": k, "nom": dm.get("nom"),
                           "active": dm.get("statut") == "active", "finalite": dm.get("finalite"), "base_legale": dm.get("base_legale") or "non renseignée (facultative)",
                           "pieces": [TYPES.get(t, t) for t in dm.get("pieces", [])], "duree_accord_jours": dm.get("duree")})
    return {"demarches": sortie}


async def registres_pour_une_demarche(p, entree):
    etat = _etat(p)
    nom = str(entree.get("demarche", "")).lower()
    dm = next((dm for dms in (etat.get("demarches") or {}).values() for dm in dms.values() if nom in (dm.get("nom") or "").lower()), None)
    if not dm:
        return {"erreur": "Démarche introuvable parmi celles de votre service."}
    service = next((s for s, dms in (etat.get("demarches") or {}).items() if dm in dms.values()), None)
    branches = {k: f for k, f in annuaire().items() if f["branche"]}
    plan = []
    for t in dm.get("pieces", []):
        offre = [f for f in branches.values() if t in f["types"] + f["predicats"]]
        plan.append({"piece": TYPES.get(t, t),
                     "registres": [f["nom"] for f in offre if "*" in (f["autorisations"].get(t) or ["*"]) or service in (f["autorisations"].get(t) or [])],
                     "refusee_par": [f["nom"] for f in offre if not ("*" in (f["autorisations"].get(t) or ["*"]) or service in (f["autorisations"].get(t) or []))]})
    return {"demarche": dm.get("nom"), "base_legale": dm.get("base_legale") or "non renseignée (facultative)", "pieces": plan}


async def agents_du_service(p, _):
    etat = _etat(p)
    return {"agents": [{"nom": _nom(etat, r["iu"]), "code": r.get("code"), "statut": r.get("statut"), "service": r.get("service")}
                       for r in etat.get("roles", []) if r.get("role") == "agent" and r.get("service") in p.services("admin")]}


async def services_et_branchements(p, _):
    etat = _etat(p)
    a = annuaire()
    return {"services": [{"nom": s.get("nom"), "statut": s.get("statut"), "branche": (a.get(k) or {}).get("branche", False),
                          "catalogue": (a.get(k) or {}).get("catalogue")} for k, s in (etat.get("services") or {}).items()]}


async def tester_les_registres(p, _):
    """Appel signé de chaque registre branché avec l'identifiant de test (aucune donnée de citoyen)."""
    async def un(client, k, v):
        try:
            _, preuve = await appeler(client, k, v["secret"], v["connexion"]["url_documents"],
                                      {"iu": IU_TEST, "demandeur": "supervision"}, v.get("adaptateur"), "documents")
            return {"registre": v["nom"], "repond": True, "signature": {"valide": "vérifiée", "absente": "réponse non signée"}[preuve["signature"]]}
        except Exception as e:
            return {"registre": v["nom"], "repond": False, "erreur": str(e)[:160] or e.__class__.__name__}

    actifs = {k: v for k, v in branchements().items() if v.get("connexion") and v.get("statut") == "actif"}
    async with appels.nouveau_client() as client:
        return {"registres": list(await asyncio.gather(*(un(client, k, v) for k, v in actifs.items())))}


# ── Catalogue des compétences ────────────────────────────────────────────────
TOUS, AGENT, ADMIN, SUPER_ADMIN = "tous", "agent", "admin", "super_admin"
SANS_PARAMETRE = {"type": "object", "properties": {}, "additionalProperties": False}

COMPETENCES = {
    "mes_demandes": (TOUS, "📄 Mes demandes", mes_demandes,
                     "Liste les démarches ouvertes au nom de la personne connectée, avec l'état de chaque pièce et de l'accord.", SANS_PARAMETRE),
    "qui_a_consulte_mes_donnees": (TOUS, "👁️ Qui a consulté mes données", qui_a_consulte_mes_donnees,
                                   "Dernières lignes du journal concernant les données de la personne connectée : échanges avec les registres, consultations par les agents, accords.",
                                   {"type": "object", "properties": {"limite": {"type": "integer", "description": "Nombre de lignes (1 à 50, 15 par défaut)."}},
                                    "additionalProperties": False}),
    "annuaire_des_registres": (TOUS, "🏛️ Registres branchés", annuaire_des_registres,
                               "Registres branchés au socle : pièces détenues, réponses oui/non proposées, accès restreints décidés par chaque registre.", SANS_PARAMETRE),
    "verifier_integrite_du_journal": (TOUS, "🔗 Intégrité du journal", verifier_integrite_du_journal,
                                      "Vérifie la chaîne d'empreintes et le sceau du journal : détecte toute ligne modifiée ou supprimée.", SANS_PARAMETRE),
    "verifier_une_identite": (AGENT, "🪪 Vérification d'identité", verifier_une_identite,
                              "Vérifie un identifiant unique (NIN, 17 chiffres) auprès du registre d'identité et renvoie le nom pour vérifier la personne en face. Journalisé.",
                              {"type": "object", "properties": {"nin": {"type": "string", "description": "Identifiant unique à 17 chiffres."}},
                               "required": ["nin"], "additionalProperties": False}),
    "dossiers_du_service": (AGENT, "🗂️ Dossiers du service", dossiers_du_service,
                            "Dossiers du service de l'agent connecté (30 plus récents), filtrables par statut.",
                            {"type": "object", "properties": {"statut": {"type": "string", "enum": list(STATUTS_DOSSIER),
                                                                         "description": "Filtrer par statut (facultatif)."}},
                             "additionalProperties": False}),
    "detail_d_un_dossier": (AGENT, "🔎 Détail d'un dossier", detail_d_un_dossier,
                            "Détail d'un dossier du service (ou du citoyen lui-même) : pièces, provenance, accord, base légale.",
                            {"type": "object", "properties": {"numero": {"type": "string", "description": "Numéro du dossier, ex. D-0004."}},
                             "required": ["numero"], "additionalProperties": False}),
    "demarches_du_service": ((AGENT, ADMIN), "📋 Démarches du service", demarches_du_service,
                             "Démarches du service : finalité, base légale si renseignée, pièces, durée de l'accord.", SANS_PARAMETRE),
    "registres_pour_une_demarche": (AGENT, "🧭 Registres d'une démarche", registres_pour_une_demarche,
                                    "Pour une démarche du service, indique auprès de quel registre chaque pièce sera demandée, et les refus éventuels.",
                                    {"type": "object", "properties": {"demarche": {"type": "string", "description": "Nom (ou partie du nom) de la démarche."}},
                                     "required": ["demarche"], "additionalProperties": False}),
    "agents_du_service": (ADMIN, "👥 Agents du service", agents_du_service, "Agents du service de l'admin connecté, avec leur code et leur statut.", SANS_PARAMETRE),
    "services_et_branchements": (SUPER_ADMIN, "🏢 Services", services_et_branchements,
                                 "Services du socle, leur statut et l'état de leur branchement à la passerelle.", SANS_PARAMETRE),
    "tester_les_registres": (SUPER_ADMIN, "📡 Test des registres", tester_les_registres,
                             "Appelle chaque registre branché avec l'identifiant de test (aucune donnée de citoyen) : répond-il, sa réponse est-elle signée ?", SANS_PARAMETRE),
}


def _roles(p: Personne) -> set:
    return {r.get("role") for r in p.roles}


def disponibles(p: Personne | None) -> dict:
    """Compétences ouvertes à la personne : selon ses rôles ; aucune sans connexion."""
    if p is None:
        return {}
    roles = _roles(p)
    return {nom: c for nom, c in COMPETENCES.items()
            if c[0] == TOUS or (set(c[0]) if isinstance(c[0], tuple) else {c[0]}) & roles}


def definitions(p: Personne | None) -> list[dict]:
    return [{"name": nom, "description": c[3], "input_schema": c[4]} for nom, c in disponibles(p).items()]


async def executer(p: Personne, nom: str, entree: dict) -> tuple[str, bool]:
    """Exécute une compétence avec les droits de la personne. Renvoie (résultat JSON, est_une_erreur)."""
    import json
    c = disponibles(p).get(nom)
    if not c:
        return json.dumps({"erreur": "Compétence non disponible pour votre rôle."}, ensure_ascii=False), True
    try:
        return json.dumps(await c[2](p, entree or {}), ensure_ascii=False, default=str), False
    except Exception as e:
        return json.dumps({"erreur": f"La vérification a échoué : {str(e)[:200] or e.__class__.__name__}"}, ensure_ascii=False), True


def libelle(nom: str) -> str:
    return COMPETENCES.get(nom, (None, nom))[1]
