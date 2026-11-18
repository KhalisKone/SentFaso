"""API de la couche consentement et minimisation.

L'accord d'un dossier est créé à l'ouverture par l'agent (service, finalité, pièces, durée), contrôlé par la passerelle avant
chaque échange, et clôturé par l'agent. Le citoyen n'a aucune démarche à faire : il voit chaque échange dans son journal.
Stockage : /consentement/accords/{dossier}, séparé de l'état du socle : aucune écriture de l'état ne peut modifier un accord.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from consentement import regles
from journal import ajouter as journaliser
from session import Personne, personne
from stockage import ref

router = APIRouter(prefix="/consentement", tags=["consentement"])


def accord(dossier: str) -> dict | None:
    return ref(f"consentement/accords/{dossier}").get()


def accords_et_preferences() -> tuple[dict, dict]:
    """Accords des dossiers ; le paramètre « Demander mon accord » du citoyen n'existe plus (préférences toujours vides)."""
    return ref("consentement/accords").get() or {}, {}


def controler(dossier: str | None, *, iu: str, demandeur: str | None, codes: list[str], appelant: Personne) -> list[str]:
    """Utilisé par la passerelle avant chaque échange : accord actif, bonne personne, bon service, pièces couvertes,
    et appelant légitime (le citoyen lui-même, ou un agent du service demandeur). Lève PermissionError sinon."""
    a = accord(dossier) if dossier else None
    permis = regles.controler(a, iu=iu, demandeur=demandeur or "", codes=codes)
    if appelant.iu != a["iu"] and not appelant.role("agent", a["service"]):
        raise PermissionError("seuls le citoyen et les agents du service demandeur peuvent déclencher cet échange")
    return permis


def _ecrire_dossier(dossier: str, statut: str):
    """Répercute la fin de l'accord sur le dossier."""
    if ref(f"socle/dossiers/{dossier}").get() is not None:
        ref(f"socle/dossiers/{dossier}/statut").set(statut)


# ── Accords ──────────────────────────────────────────────────────────────────
class Ouverture(BaseModel):
    dossier: str
    iu: str
    service: str
    finalite: str
    base_legale: str = ""  # facultative : texte qui autorise la demande, quand l'admin l'a renseigné
    pieces: list[str]
    duree: int = 30


@router.post("/accords", summary="Créer l'accord d'un dossier (agent du service)")
def creer(o: Ouverture, p: Personne = Depends(personne)):
    role = p.role("agent", o.service)
    if not role:
        raise HTTPException(403, "Seul un agent de ce service peut ouvrir un dossier.")
    if o.iu == p.iu:
        raise HTTPException(403, "Conflit d'intérêts : un agent ne peut pas ouvrir un dossier qui le concerne.")
    if not o.finalite.strip():
        raise HTTPException(400, "Finalité obligatoire.")
    if accord(o.dossier):
        raise HTTPException(409, "Ce dossier a déjà un accord.")
    a = regles.nouvel_accord(dossier=o.dossier, iu=o.iu, service=o.service, agent=role.get("code"), finalite=o.finalite,
                             base_legale=o.base_legale, pieces=o.pieces, duree=o.duree, requis=False)
    ref(f"consentement/accords/{o.dossier}").set(a)
    return a


@router.get("/accords/{dossier}", summary="Lire un accord (citoyen concerné ou agent du service)")
def lire(dossier: str, p: Personne = Depends(personne)):
    """Une tentative d'un agent d'un autre service est refusée et journalisée : le citoyen concerné la voit."""
    a = accord(dossier)
    if a and p.iu != a["iu"] and not p.role("agent", a["service"]):
        role = next((r for r in p.roles if r.get("role") == "agent"), None)
        journaliser({"auteur": p.iu, "casquette": "agent" if role else "citoyen", "code": (role or {}).get("code"),
                     "service": (role or {}).get("service"), "iu": a["iu"], "action": "Accès refusé (autre service)",
                     "cible": dossier, "resultat": "refusé"})
    if not a or (p.iu != a["iu"] and not p.role("agent", a["service"])):
        raise HTTPException(404, "Dossier introuvable ou hors de votre service.")
    return a


@router.post("/accords/{dossier}/clore", summary="L'agent clôture : l'accord prend fin")
def clore(dossier: str, p: Personne = Depends(personne)):
    a = accord(dossier)
    if not a:
        raise HTTPException(404, "Accord introuvable.")
    role = p.role("agent", a["service"])
    if not role:
        raise HTTPException(403, "Seul un agent du service peut clôturer.")
    try:
        nouveau = regles.appliquer(a, "clore", role.get("code"))
    except ValueError as e:
        raise HTTPException(409, str(e))
    ref(f"consentement/accords/{dossier}").set(nouveau)
    _ecrire_dossier(dossier, "clos")  # la clôture est journalisée par l'agent avec le dossier
    return nouveau


@router.get("/controle", summary="Vérifier qu'un échange est couvert par un accord (contrôle appliqué par la passerelle)")
def verifier_echange(dossier: str, iu: str, demandeur: str, codes: str = Query("", description="Pièces ou réponses, séparées par des virgules"),
                     p: Personne = Depends(personne)):
    try:
        permis = controler(dossier, iu=iu, demandeur=demandeur, codes=[c for c in codes.split(",") if c], appelant=p)
        return {"autorise": True, "codes_autorises": permis}
    except PermissionError as e:
        return {"autorise": False, "motif": str(e)}


def migrer_accords_existants():
    """Reprise unique : crée les accords des dossiers ouverts avant la couche consentement (ancien champ « consent »)."""
    dossiers = ref("socle/dossiers").get() or {}
    existants = ref("consentement/accords").get() or {}
    for k, d in dossiers.items():
        c = d.get("consent")
        if k in existants or not c:
            continue
        ref(f"consentement/accords/{k}").set({
            "dossier": k, "iu": d.get("iu"), "service": d.get("service"), "agent": d.get("agentCode"),
            "finalite": d.get("but") or d.get("finalite") or "", "base_legale": d.get("base_legale") or "",
            "pieces": c.get("autorisees") or list((d.get("pieces") or {}).keys()), "requis": bool(c.get("requis")),
            "statut": c.get("statut", "actif"), "le": c.get("le") or regles.maintenant(),
            "expire": d.get("expire") or regles.maintenant(), "historique": [{"le": regles.maintenant(), "action": "repris", "par": "migration"}],
        })
