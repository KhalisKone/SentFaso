"""Passerelle d'échange (/connect) : branchement des registres et échanges avec eux.

Branchement : le super admin génère un code secret pour un service ; le service vient sur /frontend/connect avec
son identifiant et son code, lit le contrat, teste ses routes et se branche. Le socle lit alors son catalogue.

Échanges : chaque appel est signé par la passerelle, chaque réponse est signée par le registre (authentification
mutuelle) ; le registre reçoit le contexte (service demandeur, dossier, finalité) et décide lui-même s'il répond.
La passerelle applique aussi les règles déclarées par le registre (elle n'envoie pas le NIN à un registre qui refusera),
ne transmet que les types demandés, et inscrit chaque échange au journal.
Avant tout échange sur une personne, la couche consentement est consultée : pas d'accord actif, pas d'échange.
"""
import asyncio
import hashlib
import hmac
import secrets
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from consentement import controler as controler_accord
from journal import ajouter as journaliser
from passerelle import appels, conformite
from passerelle import adaptateur as adapt
from passerelle.adaptateur import FormatInattendu, est_defaut
from passerelle.appels import Refus, appeler
from passerelle.securite import LIB_SIGNATURE, ReponseRejetee
from session import Personne, liste, personne
from stockage import ref

router = APIRouter(prefix="/connect", tags=["passerelle"])

IU_TEST = "00000000000000000"   # identifiant unique de test (17 chiffres)
ROUTES = ("documents", "verifier", "predicat", "lien", "catalogue")


# ── Registre des branchements ────────────────────────────────────────────────
def lire() -> dict:
    return ref("branchements").get() or {}


def ecrire(services: dict):
    ref("branchements").set(services)


def authentifier(service_id: str, secret: str) -> dict:
    s = lire().get(service_id)
    if not s or not s.get("secret") or not hmac.compare_digest(s["secret"], secret):
        raise HTTPException(401, "Identifiant ou code secret incorrect.")
    return s


def actifs(services: str | None) -> dict:
    """Services branchés et actifs, limités à la liste demandée."""
    voulus = {s for s in services.split(",") if s} if services is not None else None
    return {k: v for k, v in lire().items()
            if v.get("connexion") and v.get("statut") == "actif" and (voulus is None or k in voulus)}


def predicats_de(fiche: dict) -> list[str]:
    """Réponses oui/non d'un registre : celles qu'il propose, et celles que le socle calcule à partir de ses données."""
    declares = (fiche.get("catalogue") or {}).get("predicats") or []
    calcules = list(adapt.completer(fiche.get("adaptateur"))["calculs"])
    return [*declares, *[q for q in calcules if q not in declares]]


def autorise(fiche: dict, code: str, demandeur: str | None) -> bool:
    """Règle déclarée par le registre pour une pièce ou une réponse (par défaut : tous les services)."""
    regles = (fiche.get("catalogue") or {}).get("autorisations") or {}
    regle = regles.get(code) or regles.get("*") or ["*"]
    return "*" in regle or (demandeur or "") in regle


def verifier_liste(docs) -> str | None:
    if not isinstance(docs, list):
        return "La réponse doit être une liste JSON."
    for d in docs:
        manque = [k for k in ("id", "type", "titre", "url") if not isinstance(d, dict) or k not in d]
        if manque:
            return f"Champ(s) manquant(s) dans un document : {', '.join(manque)}."
    return None


async def tracer(action: str, registre: str, iu: str | None, demandeur: str | None, resultat: str, details: str):
    """Inscrit un échange au journal (écrit par le serveur, casquette « passerelle »)."""
    await asyncio.to_thread(journaliser, {
        "auteur": "passerelle", "casquette": "passerelle", "action": action, "cible": registre,
        "iu": iu, "service": demandeur, "resultat": resultat, "details": details,
    })


def preuve_lisible(preuve: dict) -> str:
    return f"{LIB_SIGNATURE[preuve['signature']]} · empreinte {preuve['empreinte'][:16]}"


async def couvert_par_l_accord(p: Personne, iu: str, dossier: str | None, demandeur: str | None, codes: list[str], registre: str) -> list[str]:
    """Contrôle de la couche consentement avant un échange (sauf identifiant de test). Refus journalisé, puis 403."""
    if iu == IU_TEST:
        return codes
    try:
        return controler_accord(dossier, iu=iu, demandeur=demandeur, codes=codes, appelant=p)
    except PermissionError as e:
        await tracer("Échange refusé (consentement)", registre, iu, demandeur, "refusé", f"dossier {dossier or '—'} · {e}")
        raise HTTPException(403, f"Échange refusé : {e}.")


# ── Super admin ──────────────────────────────────────────────────────────────
class ServiceIn(BaseModel):
    id: str
    nom: str
    sigle: str = ""
    type: str = ""
    tutelle: str | None = None
    ville: str = ""
    double_api: bool = False


@router.post("/services/secret", summary="Créer un service et (re)générer son code secret (super admin)")
def generer_secret(s: ServiceIn, p: Personne = Depends(personne)):
    """Crée le service s'il n'existe pas et génère (ou régénère) son code secret. Il n'est montré qu'une fois ;
    le service doit ensuite se (re)brancher."""
    if not p.super_admin:
        raise HTTPException(403, "Réservé au super admin.")
    services = lire()
    fiche = services.get(s.id) or {**s.model_dump(exclude={"id"}), "statut": "actif", "connexion": None}
    fiche["double_api"] = s.double_api
    fiche["secret"] = "sk_" + secrets.token_urlsafe(24)
    fiche["connexion"] = None
    services[s.id] = fiche
    ecrire(services)
    ref(f"socle/supprimes/{s.id}").delete()  # un service supprimé puis recréé redevient normal
    return {"id": s.id, "secret": fiche["secret"]}


class FicheService(BaseModel):
    nom: str
    sigle: str = ""
    type: str = ""
    tutelle: str | None = None
    ville: str = ""


@router.put("/services/{service_id}/fiche", summary="Modifier la fiche d'un service : nom, sigle, type, tutelle, ville (super admin)")
def modifier_fiche(service_id: str, f: FicheService, p: Personne = Depends(personne)):
    """L'identifiant, le code secret et le branchement ne changent pas : le service reste branché."""
    if not p.super_admin:
        raise HTTPException(403, "Réservé au super admin.")
    if not f.nom.strip():
        raise HTTPException(400, "Indiquez le nom du service.")
    services = lire()
    if service_id not in services:
        raise HTTPException(404, "Service inconnu.")
    services[service_id].update({"nom": f.nom.strip(), "sigle": f.sigle.strip(), "type": f.type, "tutelle": f.tutelle or None, "ville": f.ville.strip()})
    ecrire(services)
    return {"ok": True, "id": service_id}


FINAUX = {"clos", "refuse", "revoque"}


@router.delete("/services/{service_id}", summary="Supprimer un service (super admin)")
def supprimer_service(service_id: str, p: Personne = Depends(personne)):
    """Retire le service et annule son code ; révoque ses admins et agents ; retire ses démarches.
    Les dossiers et le journal sont conservés. Refusé si des dossiers du service ne sont pas clôturés, ou si c'est le seul
    service qui vérifie les codes uniques (plus personne ne pourrait se connecter)."""
    if not p.super_admin:
        raise HTTPException(403, "Réservé au super admin.")
    services = lire()
    etat = ref("socle").get() or {}
    if service_id not in services and service_id not in (etat.get("services") or {}):
        raise HTTPException(404, "Service inconnu.")
    fiche = services.get(service_id) or {}
    nom = (etat.get("services") or {}).get(service_id, {}).get("nom") or fiche.get("nom") or service_id
    ouverts = [k for k, d in (etat.get("dossiers") or {}).items() if d.get("service") == service_id and d.get("statut") not in FINAUX]
    if ouverts:
        raise HTTPException(409, f"{len(ouverts)} dossier(s) de ce service ne sont pas clôturés : faites-les clôturer par ses agents, "
                                 "ou désactivez plutôt le service.")
    autres_identites = [k for k, v in services.items() if k != service_id and v.get("double_api") and v.get("connexion") and v.get("statut") == "actif"]
    if fiche.get("double_api") and fiche.get("connexion") and not autres_identites:
        raise HTTPException(409, "C'est le seul service qui vérifie les codes uniques : sans lui, plus personne ne pourrait se connecter.")

    services.pop(service_id, None)
    ecrire(services)
    bilan = {}

    def retirer(e):
        e = e or {}
        e.get("services", {}).pop(service_id, None)
        for s in (e.get("services") or {}).values():
            if s.get("tutelle") == service_id:
                s["tutelle"] = None
        bilan["demarches"] = len((e.get("demarches") or {}).pop(service_id, None) or {})
        roles = liste(e.get("roles"))
        bilan["roles"] = 0
        for r in roles:
            if r.get("service") == service_id and r.get("statut") == "actif":
                r["statut"], bilan["roles"] = "revoque", bilan["roles"] + 1
        e["roles"] = roles
        e.setdefault("supprimes", {})[service_id] = time.strftime("%Y-%m-%dT%H:%M:%S")
        return e

    ref("socle").transaction(retirer)
    sa = p.role("super_admin") or {}
    journaliser({"auteur": p.iu, "code": sa.get("code"), "casquette": "super_admin", "service": None, "action": "Service supprimé",
                 "cible": nom, "details": f"code annulé · {bilan['roles']} rôle(s) révoqué(s) · {bilan['demarches']} démarche(s) retirée(s)"})
    return {"ok": True, "nom": nom, **bilan}


@router.get("/services", summary="Annuaire public des registres")
def annuaire():
    """Pour chaque service : branché ou non, pièces et réponses qu'il propose, services qu'il autorise."""
    sortie = {}
    for k, v in lire().items():
        cat = v.get("catalogue") or {}
        sortie[k] = {
            "nom": v["nom"], "branche": bool(v.get("connexion")), "double_api": bool(v.get("double_api")),
            "types": cat.get("types", []), "predicats": predicats_de(v), "autorisations": cat.get("autorisations", {}),
            "catalogue": cat.get("source"), "adaptateur": not est_defaut(v.get("adaptateur")),
        }
    return sortie


# ── Service qui vient se brancher ────────────────────────────────────────────
class Identifiants(BaseModel):
    service_id: str
    secret: str


class Catalogue(BaseModel):
    types: list[str] = []
    predicats: list[str] = []


class Branchement(Identifiants):
    url_documents: str
    url_verifier: str | None = None
    url_predicat: str | None = None
    url_lien: str | None = None
    url_catalogue: str | None = None
    adaptateur: dict | None = None
    catalogue_declare: Catalogue | None = Field(None, description="Déclaration manuelle, si le registre n'expose pas /catalogue.")


class Test(Identifiants):
    quoi: str = Field(description="documents | verifier | predicat | catalogue | calcul")
    url: str
    q: str | None = Field(None, description="Réponse à tester, pour quoi=predicat ou calcul (ex. majeur).")
    adaptateur: dict | None = None
    iu_essai: str | None = Field(None, description="Pour quoi=calcul : code unique d'une personne connue du registre.")


async def tester_api(client, service_id: str, secret: str, quoi: str, url: str, adaptateur=None, q=None):
    """Appelle une route du registre avec l'identifiant de test et contrôle le format. Lève HTTPException si KO."""
    params = {"iu": IU_TEST, "demandeur": "test-de-branchement"} if quoi != "catalogue" else {}
    if quoi == "predicat":
        params["q"] = q or "majeur"
    try:
        rep, preuve = await appeler(client, service_id, secret, url, params, adaptateur, quoi)
    except httpx.HTTPStatusError as e:
        if quoi != "verifier" or e.response.status_code != 404:
            raise HTTPException(400, f"Votre API ({url}) ne répond pas correctement : {e}")
        rep, preuve = {"valide": False}, {"signature": "absente", "empreinte": ""}  # fiche absente = identifiant inconnu
    except ReponseRejetee as e:
        raise HTTPException(400, f"Réponse refusée : {e}. Vérifiez la signature de vos réponses (section 3 de la page de branchement).")
    except FormatInattendu as e:
        raise HTTPException(400, f"Format inattendu : {e}. Réglez l'adaptateur.")
    except Refus as e:
        raise HTTPException(400, f"Votre registre a refusé l'appel de test : {e}.")
    except Exception as e:
        raise HTTPException(400, f"Votre API ({url}) ne répond pas correctement : {e or e.__class__.__name__}")
    if quoi == "documents" and (err := verifier_liste(rep)):
        raise HTTPException(400, err)
    if quoi == "verifier" and not isinstance(rep.get("valide"), bool):
        raise HTTPException(400, 'La réponse doit être {"valide": true|false, ...}.')
    if quoi == "predicat" and not (isinstance(rep, dict) and rep.get("reponse") in (True, False, None)):
        raise HTTPException(400, 'La réponse doit être {"q": "...", "reponse": true|false|null}.')
    if quoi == "catalogue" and not (isinstance(rep, dict) and isinstance(rep.get("types"), list)):
        raise HTTPException(400, 'Le catalogue doit être {"types": [...], "predicats": [...], "autorisations": {...}}.')
    return rep, preuve["signature"]


@router.post("/tester", summary="Tester une route d'un registre, sans rien enregistrer")
async def tester(t: Test):
    s = authentifier(t.service_id, t.secret)
    if t.quoi == "calcul":  # réponse calculée par le socle : seule la réponse oui/non est montrée, jamais la donnée source
        q = t.q or "majeur"
        reglage = {**(t.adaptateur or {}), "calculs": {q: {"url": t.url, "champ": ((t.adaptateur or {}).get("calculs") or {}).get(q, {}).get("champ", "")}}}
        if not adapt.completer(reglage)["calculs"].get(q):
            raise HTTPException(400, "Indiquez l'adresse et le champ de la donnée source.")
        iu = "".join((t.iu_essai or "").split())
        if not (iu.isdigit() and len(iu) == 17):
            raise HTTPException(400, "Indiquez le code unique (17 chiffres) d'une personne connue de votre registre.")
        async with appels.nouveau_client() as client:
            try:
                reponse, preuve = await calculer_reponse(client, t.service_id, {**s, "secret": t.secret, "adaptateur": reglage}, q, iu,
                                                         {"demandeur": "test-de-branchement"})
            except Exception as e:
                raise HTTPException(400, f"Votre API ({t.url}) ne répond pas correctement : {e or e.__class__.__name__}")
        texte = {True: "oui", False: "non", None: "inconnu (personne absente ou champ introuvable)"}[reponse]
        return {"ok": True, "reponse": {"q": q, "reponse": texte}, "signature": preuve.get("signature")}
    async with appels.nouveau_client() as client:
        reponse, signature = await tester_api(client, t.service_id, t.secret, t.quoi, t.url, t.adaptateur, t.q)
    return {"ok": True, "reponse": reponse, "signature": signature}


@router.post("/session", summary="Ouvrir l'espace de branchement d'un service")
def session(i: Identifiants):
    s = authentifier(i.service_id, i.secret)
    return {"nom": s["nom"], "double_api": bool(s.get("double_api")), "connexion": s.get("connexion"),
            "catalogue": s.get("catalogue"), "adaptateur": s.get("adaptateur"), "socle_identifiant_test": IU_TEST}


async def lire_catalogue(client, b: Branchement) -> dict | None:
    """Catalogue lu chez le registre (/catalogue), sinon déclaration manuelle, sinon inconnu."""
    if b.url_catalogue:
        cat, _ = await tester_api(client, b.service_id, b.secret, "catalogue", b.url_catalogue)
        return {"types": cat.get("types", []), "predicats": cat.get("predicats", []),
                "autorisations": cat.get("autorisations") or {}, "source": "registre", "le": time.strftime("%Y-%m-%dT%H:%M:%S")}
    if b.catalogue_declare and (b.catalogue_declare.types or b.catalogue_declare.predicats):
        return {**b.catalogue_declare.model_dump(), "autorisations": {}, "source": "declaration", "le": time.strftime("%Y-%m-%dT%H:%M:%S")}
    return None


@router.post("/brancher", summary="Tester puis brancher un registre")
async def brancher(b: Branchement):
    s = authentifier(b.service_id, b.secret)
    if not s.get("double_api"):
        b.url_verifier = None
    elif not b.url_verifier:
        raise HTTPException(400, "Ce service est en double API : l'URL de vérification est obligatoire.")
    async with appels.nouveau_client() as client:
        docs, signature = await tester_api(client, b.service_id, b.secret, "documents", b.url_documents, b.adaptateur)
        if b.url_verifier:
            await tester_api(client, b.service_id, b.secret, "verifier", b.url_verifier, b.adaptateur)
        catalogue = await lire_catalogue(client, b)
        if b.url_predicat and catalogue and catalogue["predicats"]:
            await tester_api(client, b.service_id, b.secret, "predicat", b.url_predicat, q=catalogue["predicats"][0])
    services = lire()
    services[b.service_id]["connexion"] = {
        **{f"url_{r}": getattr(b, f"url_{r}") for r in ROUTES}, "branche_le": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    services[b.service_id]["catalogue"] = catalogue
    services[b.service_id]["adaptateur"] = None if est_defaut(b.adaptateur) else b.adaptateur
    ecrire(services)
    return {"ok": True, "message": f"{s['nom']} est branché.", "reponse_test": docs, "signature": signature, "catalogue": catalogue}


@router.post("/catalogue/actualiser", summary="Relire le catalogue et les règles d'accès d'un registre")
async def actualiser_catalogue(i: Identifiants):
    s = authentifier(i.service_id, i.secret)
    c = s.get("connexion") or {}
    if not c.get("url_catalogue"):
        raise HTTPException(400, "Ce registre n'expose pas de route /catalogue.")
    b = Branchement(service_id=i.service_id, secret=i.secret, url_documents=c["url_documents"], url_catalogue=c["url_catalogue"])
    async with appels.nouveau_client() as client:
        catalogue = await lire_catalogue(client, b)
    services = lire()
    services[i.service_id]["catalogue"] = catalogue
    ecrire(services)
    return catalogue


# ── Preuve d'interopérabilité : banc de conformité et santé des registres ────
class Banc(Identifiants):
    url_documents: str
    url_catalogue: str | None = None
    url_predicat: str | None = None
    url_verifier: str | None = None
    adaptateur: dict | None = None


async def passer_au_banc(service_id: str, fiche: dict, secret: str, urls: dict, adaptateur: dict | None) -> dict:
    async with appels.nouveau_client() as client:
        res = await conformite.banc(client, service_id, secret, urls, adaptateur, bool(fiche.get("double_api")))
    await tracer("Banc de conformité", fiche.get("nom", service_id), None, None, "réussi" if res["conforme"] else "non conforme",
                 f"{res['obligatoires_ok']}/{res['obligatoires']} critères obligatoires · {res['recommandes_ok']}/{res['recommandes']} recommandés")
    return res


@router.post("/conformite", summary="Banc de conformité : le registre vérifie lui-même qu'il respecte le contrat (avant ou après branchement)")
async def banc_conformite(b: Banc):
    """N'utilise que l'identifiant de test et un identifiant fictif ; tente aussi des appels que le registre DOIT refuser."""
    s = authentifier(b.service_id, b.secret)
    urls = {"documents": b.url_documents, "catalogue": b.url_catalogue, "predicat": b.url_predicat, "verifier": b.url_verifier}
    return await passer_au_banc(b.service_id, s, b.secret, urls, b.adaptateur)


@router.post("/conformite/{service_id}", summary="Repasser au banc un registre branché (super admin)")
async def banc_registre_branche(service_id: str, p: Personne = Depends(personne)):
    if not p.super_admin:
        raise HTTPException(403, "Réservé au super admin.")
    s = lire().get(service_id)
    if not s or not s.get("connexion"):
        raise HTTPException(404, "Ce registre n'est pas branché.")
    c = s["connexion"]
    urls = {"documents": c["url_documents"], "catalogue": c.get("url_catalogue"), "predicat": c.get("url_predicat"), "verifier": c.get("url_verifier")}
    return await passer_au_banc(service_id, s, s["secret"], urls, s.get("adaptateur"))


@router.get("/sante", summary="Santé des registres branchés : répond, temps de réponse, signature (super admin)")
async def sante_des_registres(p: Personne = Depends(personne)):
    if not p.super_admin:
        raise HTTPException(403, "Réservé au super admin.")
    async with appels.nouveau_client() as client:
        return await conformite.sante(client, lire())


# ── Échanges (utilisés par le socle) ─────────────────────────────────────────
@router.get("/documents", summary="Pièces détenues sur une personne, auprès des registres utiles")
async def documents(iu: str, services: str | None = None, types: str | None = None, dossier: str | None = None,
                    demandeur: str | None = None, finalite: str | None = None, p: Personne = Depends(personne)):
    """Interroge en parallèle les registres indiqués (`services`), pour les seuls types demandés (`types`)
    et couverts par l'accord du dossier. Un registre dont les règles n'autorisent pas `demandeur` n'est pas appelé."""
    iu = "".join(iu.split())
    voulus = [t for t in types.split(",") if t] if types else None
    if iu != IU_TEST:
        if not voulus:
            raise HTTPException(400, "Indiquez les types de pièces demandés (minimisation).")
        voulus = await couvert_par_l_accord(p, iu, dossier, demandeur, voulus, "passerelle")
    branches = actifs(services)

    async def un(client, k, v):
        offerts = (v.get("catalogue") or {}).get("types") or None
        demandes = voulus if offerts is None or voulus is None else [t for t in voulus if t in offerts]
        permis = None if demandes is None else [t for t in demandes if autorise(v, t, demandeur)]
        if demandes is not None and not demandes:
            return k, [], None, None, None
        if permis is not None and not permis:
            return k, [], None, "votre service n'est pas autorisé par ce registre pour ces pièces", None
        params = {"iu": iu, "types": ",".join(permis) if permis else None, "demandeur": demandeur, "dossier": dossier, "finalite": finalite}
        try:
            docs, preuve = await appeler(client, k, v["secret"], v["connexion"]["url_documents"], params, v.get("adaptateur"), "documents")
        except Refus as e:
            return k, [], None, str(e), None
        except Exception as e:
            return k, [], str(e) or e.__class__.__name__, None, None
        if permis is not None:
            docs = [d for d in docs if d.get("type") in permis]  # minimisation : rien au-delà de ce qui est demandé et permis
        return k, docs, None, None, preuve

    async with appels.nouveau_client() as client:
        res = await asyncio.gather(*(un(client, k, v) for k, v in branches.items()))
    sortie = []
    for k, d, erreur, refus, preuve in res:
        if erreur or refus or preuve:
            resume = (f"refusé : {refus}" if refus else f"échec : {erreur}" if erreur else f"{len(d)} document(s) · {preuve_lisible(preuve)}")
            await tracer("Échange avec un registre", branches[k]["nom"], iu, demandeur,
                         "refusé" if refus else "erreur" if erreur else "réussi", f"dossier {dossier or '—'} · {resume}")
        sortie.append({"service": k, "nom": branches[k]["nom"], "documents": d, "erreur": erreur, "refus": refus,
                       "signature": preuve["signature"] if preuve else None})
    return sortie


async def calculer_reponse(client, k: str, v: dict, q: str, iu: str, contexte: dict) -> tuple[bool | None, dict]:
    """Lit la donnée source chez le registre (appel signé), calcule oui/non, et ne garde que la réponse.
    Une personne inconnue du registre (404) donne « inconnu »."""
    c = adapt.completer(v.get("adaptateur"))["calculs"][q]
    try:
        brut, preuve = await appeler(client, k, v.get("secret", ""), c["url"], {"iu": iu, **contexte}, v.get("adaptateur"), "brut")
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            return None, {"signature": "absente", "empreinte": ""}
        raise
    reponse = adapt.calculer(q, adapt.valeur(brut, c["champ"]))
    # La fiche lue (avec la date de naissance) n'est pas gardée : pas même son empreinte, seulement celle de la réponse.
    return reponse, {"signature": preuve["signature"], "empreinte": hashlib.sha256(f"{q}:{reponse}".encode()).hexdigest()}


@router.get("/predicat", summary="Réponse minimale oui/non (ex. majeur), sans transmettre la donnée source")
async def predicat(iu: str, q: str, services: str | None = None, dossier: str | None = None,
                   demandeur: str | None = None, finalite: str | None = None, p: Personne = Depends(personne)):
    iu = "".join(iu.split())
    await couvert_par_l_accord(p, iu, dossier, demandeur, [q], "passerelle")
    def calcul(v):
        return adapt.completer(v.get("adaptateur"))["calculs"].get(q)

    branches = {k: v for k, v in actifs(services).items()
                if calcul(v) or (v["connexion"].get("url_predicat") and q in ((v.get("catalogue") or {}).get("predicats") or []))}

    async def un(client, k, v):
        if not autorise(v, q, demandeur):
            return k, None, None, "votre service n'est pas autorisé par ce registre pour cette réponse", None
        params = {"iu": iu, "q": q, "demandeur": demandeur, "dossier": dossier, "finalite": finalite}
        try:
            if calcul(v):  # le registre ne répond pas oui/non : le socle lit la donnée source, calcule, puis l'oublie
                reponse, preuve = await calculer_reponse(client, k, v, q, iu, {"demandeur": demandeur, "dossier": dossier, "finalite": finalite})
                return k, reponse, None, None, {**preuve, "calculee": True}
            rep, preuve = await appeler(client, k, v["secret"], v["connexion"]["url_predicat"], params)
            return k, rep.get("reponse") if isinstance(rep, dict) else None, None, None, preuve
        except Refus as e:
            return k, None, None, str(e), None
        except Exception as e:
            return k, None, str(e) or e.__class__.__name__, None, None

    async with appels.nouveau_client() as client:
        res = await asyncio.gather(*(un(client, k, v) for k, v in branches.items()))
    sortie = []
    for k, reponse, erreur, refus, preuve in res:
        valeur = "inconnu" if reponse is None else ("oui" if reponse else "non")
        origine = " · calculée par le socle (donnée source ni transmise ni conservée)" if preuve and preuve.get("calculee") else ""
        resume = f"refusé : {refus}" if refus else f"échec : {erreur}" if erreur else f"{q} : {valeur}{origine} · {preuve_lisible(preuve)}"
        await tracer("Réponse minimale demandée", branches[k]["nom"], iu, demandeur,
                     "refusé" if refus else "erreur" if erreur else "réussi", f"dossier {dossier or '—'} · {resume}")
        sortie.append({"service": k, "nom": branches[k]["nom"], "reponse": reponse, "erreur": erreur, "refus": refus,
                       "signature": preuve["signature"] if preuve else None})
    return sortie


@router.get("/lien", summary="Lien court vers le fichier d'une pièce, redemandé au registre à chaque consultation")
async def lien(service: str, document: str, type: str, iu: str, dossier: str | None = None,
               demandeur: str | None = None, finalite: str | None = None, p: Personne = Depends(personne)):
    """Le fichier ne transite pas par la passerelle : le registre délivre un lien signé de courte durée,
    que le navigateur de l'agent ouvre directement chez lui. Chaque délivrance est journalisée."""
    v = actifs(service).get(service)
    if not v or not v["connexion"].get("url_lien"):
        raise HTTPException(404, "Ce registre ne délivre pas de lien court.")
    await couvert_par_l_accord(p, "".join(iu.split()), dossier, demandeur, [type], v["nom"])
    if not autorise(v, type, demandeur):
        await tracer("Lien de consultation refusé", v["nom"], iu, demandeur, "refusé", f"dossier {dossier or '—'} · {type} {document}")
        raise HTTPException(403, "Votre service n'est pas autorisé par ce registre pour cette pièce.")
    params = {"iu": "".join(iu.split()), "document": document, "demandeur": demandeur, "dossier": dossier, "finalite": finalite}
    try:
        async with appels.nouveau_client() as client:
            rep, preuve = await appeler(client, service, v["secret"], v["connexion"]["url_lien"], params)
    except Refus as e:
        await tracer("Lien de consultation refusé", v["nom"], iu, demandeur, "refusé", f"dossier {dossier or '—'} · {e}")
        raise HTTPException(403, str(e))
    except Exception as e:
        await tracer("Lien de consultation refusé", v["nom"], iu, demandeur, "erreur", f"dossier {dossier or '—'} · échec : {e or e.__class__.__name__}")
        raise HTTPException(502, "Registre injoignable.")
    await tracer("Lien de consultation délivré", v["nom"], iu, demandeur, "réussi",
                 f"dossier {dossier or '—'} · {type} {document} · {preuve_lisible(preuve)}")
    return {"url": rep.get("url"), "expire": rep.get("expire")}


async def verifier_identite(iu: str, demandeur: str | None) -> dict:
    """Vérifie un identifiant unique auprès des services d'identité (double API), tous interrogés en parallèle : il suffit que
    l'un le reconnaisse (ex. le ministère, ou l'état civil du jury). Chaque appel est journalisé.
    Minimisation : seuls « valide », le nom et les prénoms sont gardés."""
    iu = "".join(iu.split())
    sources = {k: v for k, v in lire().items()
               if v.get("double_api") and v.get("statut") == "actif" and (v.get("connexion") or {}).get("url_verifier")}
    if not sources:
        raise HTTPException(503, "Aucun service de vérification n'est branché.")

    async def une(client, k, v):
        try:
            rep, preuve = await appeler(client, k, v["secret"], v["connexion"]["url_verifier"], {"iu": iu, "demandeur": demandeur},
                                        v.get("adaptateur"), "verifier")
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:  # fiche absente : personne inconnue de ce registre
                await tracer("Vérification d'identité", v["nom"], iu, demandeur, "réussi", "identifiant inconnu")
                return k, {"valide": False}, None
            await tracer("Vérification d'identité", v["nom"], iu, demandeur, "erreur", f"échec : {e}")
            return k, None, e
        except Exception as e:
            await tracer("Vérification d'identité", v["nom"], iu, demandeur, "erreur", f"échec : {e or e.__class__.__name__}")
            return k, None, e
        valide = rep.get("valide") is True
        await tracer("Vérification d'identité", v["nom"], iu, demandeur, "réussi",
                     f"{'identifiant reconnu' if valide else 'identifiant inconnu'} · {LIB_SIGNATURE[preuve['signature']]}")
        return k, rep, None

    async with appels.nouveau_client() as client:
        resultats = await asyncio.gather(*(une(client, k, v) for k, v in sources.items()))
    for _, rep, _ in resultats:
        if rep and rep.get("valide") is True:
            ref(f"socle/personnes/{iu}").set({"nom": rep.get("nom"), "prenoms": rep.get("prenoms")})
            return {"valide": True, "nom": rep.get("nom"), "prenoms": rep.get("prenoms")}
    if any(err for _, _, err in resultats):  # une source muette : on ne conclut pas « inconnu », on fait réessayer
        raise HTTPException(502, "Registre d'identité injoignable : réessayez dans un instant.")
    return {"valide": False}


@router.get("/verifier", summary="Vérifier un identifiant unique auprès du registre d'identité (agents et administrateurs)")
async def verifier(iu: str, demandeur: str | None = None, p: Personne = Depends(personne)):
    """Réservé aux personnes qui ont un rôle (vérification au guichet, nominations)."""
    if not p.a_un_role():
        raise HTTPException(403, "Réservé aux agents et administrateurs.")
    return await verifier_identite(iu, demandeur)
