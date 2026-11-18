"""Connexion et identité des personnes (socle, transversal à toutes les couches).

Connexion : identifiant unique (NIN) + code à usage unique envoyé par SMS. En démonstration (SOCLE_DEMO≠0),
aucun SMS n'est envoyé : le code est renvoyé à l'écran. Le code est stocké haché, valable 5 minutes, 3 essais.
La session est un jeton signé (HMAC-SHA256) porté par l'en-tête Authorization: Bearer.
Les rôles ne sont jamais lus dans le jeton : ils sont relus dans l'état du socle à chaque requête
(une révocation prend effet immédiatement).
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from stockage import ref

router = APIRouter(prefix="/session", tags=["session"])

DUREE_CODE, ESSAIS_MAX, DUREE_SESSION = 300, 3, 8 * 3600
ENVOIS_MAX, FENETRE_ENVOIS = 5, 600
_cle: str | None = None


def demo() -> bool:
    return os.environ.get("SOCLE_DEMO", "1") != "0"


def cle() -> str:
    global _cle
    if not _cle:
        _cle = ref("securite/cle_session").get()
        if not _cle:
            _cle = secrets.token_hex(32)
            ref("securite/cle_session").set(_cle)
    return _cle


def _b64(octets: bytes) -> str:
    return base64.urlsafe_b64encode(octets).decode().rstrip("=")


def emettre_jeton(iu: str) -> str:
    charge = _b64(json.dumps({"iu": iu, "exp": int(time.time()) + DUREE_SESSION}).encode())
    return f"{charge}.{hmac.new(cle().encode(), charge.encode(), hashlib.sha256).hexdigest()}"


def lire_jeton(jeton: str) -> str | None:
    try:
        charge, sig = jeton.split(".", 1)
        if not hmac.compare_digest(hmac.new(cle().encode(), charge.encode(), hashlib.sha256).hexdigest(), sig):
            return None
        donnees = json.loads(base64.urlsafe_b64decode(charge + "=" * (-len(charge) % 4)))
        return donnees["iu"] if donnees["exp"] > time.time() else None
    except Exception:
        return None


# ── Personne connectée et rôles ──────────────────────────────────────────────
def liste(x) -> list:
    return [v for v in (x if isinstance(x, list) else (x or {}).values()) if v]


def roles_actifs(iu: str) -> list[dict]:
    """Rôles actifs d'une personne, relus dans l'état du socle (ou dans l'installation si l'état est vide)."""
    roles = liste(ref("socle/roles").get())
    if not roles:
        roles = [{"id": k, **v} for k, v in ((ref("installation").get() or {}).get("roles") or {}).items()]
    return [r for r in roles if r.get("iu") == iu and r.get("statut") == "actif"]


class Personne:
    def __init__(self, iu: str):
        self.iu = iu
        self.roles = roles_actifs(iu)

    def services(self, role: str) -> set:
        return {r.get("service") for r in self.roles if r.get("role") == role}

    @property
    def super_admin(self) -> bool:
        return any(r.get("role") == "super_admin" for r in self.roles)

    def role(self, role: str, service: str | None = None) -> dict | None:
        return next((r for r in self.roles if r.get("role") == role and (service is None or r.get("service") == service)), None)

    def a_un_role(self) -> bool:
        return bool(self.roles)


def personne(request: Request) -> Personne:
    """Dépendance FastAPI : la personne connectée, ou 401."""
    entete = request.headers.get("Authorization", "")
    iu = lire_jeton(entete[7:]) if entete.startswith("Bearer ") else None
    if not iu:
        raise HTTPException(401, "Session absente ou expirée : reconnectez-vous.")
    return Personne(iu)


# ── Routes ───────────────────────────────────────────────────────────────────
class DemandeCode(BaseModel):
    iu: str = Field(description="Identifiant unique (NIN, 17 chiffres).")


class Ouverture(DemandeCode):
    code: str


@router.post("/code", summary="Demander un code de connexion (SMS ; affiché à l'écran en démonstration)")
async def demander_code(d: DemandeCode):
    """Réponse neutre : on ne révèle pas si l'identifiant existe. En démonstration, `code_demo` contient le code."""
    from passerelle.api import verifier_identite  # import tardif : la passerelle dépend aussi du socle
    iu = "".join(d.iu.split())
    if not (iu.isdigit() and len(iu) == 17):
        raise HTTPException(400, "L'identifiant unique compte 17 chiffres.")
    maintenant = int(time.time())
    fiche = ref(f"sessions/codes/{iu}").get() or {}
    envois = [t for t in fiche.get("envois", []) if t > maintenant - FENETRE_ENVOIS]
    if len(envois) >= ENVOIS_MAX:
        raise HTTPException(429, "Trop de demandes de code : réessayez dans quelques minutes.")
    identite = await verifier_identite(iu, "portail")
    code = None
    if identite.get("valide"):
        code = f"{secrets.randbelow(10**6):06d}"
        ref(f"sessions/codes/{iu}").set({"hash": hashlib.sha256(f"{iu}:{code}".encode()).hexdigest(),
                                         "expire": maintenant + DUREE_CODE, "essais": 0, "envois": envois + [maintenant]})
    return {"message": "Si cet identifiant existe, un code a été envoyé par SMS au numéro enregistré.",
            "code_demo": code if demo() else None}


@router.post("/ouvrir", summary="Ouvrir une session avec le code reçu")
def ouvrir(o: Ouverture):
    from journal import ajouter as journaliser
    iu = "".join(o.iu.split())
    fiche = ref(f"sessions/codes/{iu}").get()
    if not fiche or fiche["expire"] < time.time() or fiche["essais"] >= ESSAIS_MAX:
        raise HTTPException(401, "Code expiré ou trop d'essais : demandez un nouveau code.")
    if not hmac.compare_digest(fiche["hash"], hashlib.sha256(f"{iu}:{o.code.strip()}".encode()).hexdigest()):
        ref(f"sessions/codes/{iu}/essais").set(fiche["essais"] + 1)
        raise HTTPException(401, "Code incorrect.")
    ref(f"sessions/codes/{iu}").delete()  # usage unique
    journaliser({"auteur": iu, "casquette": "citoyen", "action": "Connexion", "iu": iu, "details": "identifiant unique + code à usage unique"})
    return {"jeton": emettre_jeton(iu), "iu": iu, "expire_dans": DUREE_SESSION}


@router.get("", summary="Personne connectée et ses rôles")
def moi(request: Request):
    p = personne(request)
    identite = (ref(f"socle/personnes/{p.iu}").get() or {})
    return {"iu": p.iu, "nom": identite.get("nom"), "prenoms": identite.get("prenoms"),
            "roles": [{"role": r["role"], "service": r.get("service"), "code": r.get("code")} for r in p.roles]}
