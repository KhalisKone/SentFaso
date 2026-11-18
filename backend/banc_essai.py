"""Banc d'essai commun aux tests des couches : socle en mémoire (sans Firebase), registres simulés joints
par des transports ASGI (aucun réseau), connexion par code à usage unique (renvoyé en mode démonstration).

Chaque couche a son dossier tests/ dont le conftest.py importe ce module :  from banc_essai import *
"""
import hashlib
import hmac
import json
import os
import sys
import time
from pathlib import Path

RACINE = Path(__file__).resolve().parents[1]
os.environ["SOCLE_STOCKAGE"] = "memoire"
os.environ["SOCLE_DEMO"] = "1"
for prefixe in ("ETAT_CIVIL", "JUSTICE", "NATIONALITE", "IDENTITE"):
    os.environ[f"{prefixe}_SECRET"] = "secret-provisoire"
    os.environ[f"{prefixe}_CONSOLE_JETON"] = "jeton-test"
for chemin in (RACINE / "registres", RACINE / "backend", RACINE):
    if str(chemin) not in sys.path:
        sys.path.insert(0, str(chemin))

import httpx  # noqa: E402
import pytest  # noqa: E402
from fastapi import FastAPI, HTTPException, Request, Response  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
import serveur  # noqa: E402
import session as module_session  # noqa: E402
import stockage  # noqa: E402
from etat_civil.app import registre as etat_civil  # noqa: E402
from identite.app import registre as identite  # noqa: E402
from justice.app import registre as justice  # noqa: E402
from nationalite.app import registre as nationalite  # noqa: E402
from passerelle import appels  # noqa: E402

REGISTRES = "http://registres.test/registres"
SERVICES = {  # identifiant du service dans le socle → (registre, chemin)
    "mairie-de-ouagadougou": (etat_civil, "etat-civil"),
    "tribunal-de-ouagadougou": (justice, "justice"),
    "registre-de-la-nationalite": (nationalite, "nationalite"),
}
SUPER_ADMIN, AGENT_PASSEPORTS, ADMIN_PASSEPORTS = "99000000000000001", "99000000000000013", "99000000000000014"
ADULTE_MARIE, MINEUR, CONDAMNE = "99000000000000003", "99000000000000002", "99000000000000017"

# ── Registres de test (formats et comportements particuliers) ────────────────
SECRETS_FAUX = {}


def signe(req: Request, donnees, secret: str, fausser=False) -> Response:
    corps = json.dumps(donnees).encode()
    ts = str(int(time.time()))
    chemin = req.url.path + ("?" + req.url.query if req.url.query else "")
    cle = (secret + ("x" if fausser else "")).encode()
    sig = hmac.new(cle, f"{ts}\n{chemin}\n{hashlib.sha256(corps).hexdigest()}".encode(), hashlib.sha256).hexdigest()
    return Response(corps, media_type="application/json", headers={"X-Registre-Horodatage": ts, "X-Registre-Signature": sig})


externe = FastAPI()  # registre d'une autre équipe : autre format, réponses non signées


@externe.get("/api/pieces")
def pieces(nin: str):
    items = [] if nin == "0" * 17 else [{"ref": "EXT-1", "categorie": "NAISSANCE", "libelle": "Extrait de naissance", "lien": "https://ext.test/f/1"},
                                         {"ref": "EXT-2", "categorie": "AUTRE", "libelle": "Autre pièce", "lien": "https://ext.test/f/2"}]
    return {"statut": "ok", "data": {"items": items}}


usurpateur = FastAPI()  # signe ses réponses avec une mauvaise clé


@usurpateur.get("/documents")
def documents_usurpes(req: Request, iu: str):
    return signe(req, [], SECRETS_FAUX.get("usurpateur", ""), fausser=True)


jury = FastAPI()  # registre « du jury » : fiches de personnes (date de naissance, casier), sans réponse oui/non ni signature
PERSONNES_JURY = {
    "12345678901234567": {"nom": "SANOU", "prenom": "Awa", "date_naissance": "1990-05-04", "mentions": []},
    "12345678901234568": {"nom": "SANOU", "prenom": "Ali", "date_naissance": "2015-01-01", "mentions": ["vol simple (2024)"]},
}


@jury.get("/personnes/{nin}")
def personne_jury(nin: str):
    p = PERSONNES_JURY.get(nin)
    if not p:
        raise HTTPException(404, "personne inconnue")
    return {"data": {k: v for k, v in p.items() if k != "mentions"}}


@jury.get("/casier")
def casier_jury(nin: str):
    p = PERSONNES_JURY.get(nin)
    return {"nin": nin, "mentions": p["mentions"]} if p else {"nin": nin}


@jury.get("/documents")
def documents_jury(nin: str):
    return {"items": [] if nin not in PERSONNES_JURY else [{"ref": f"AN-{nin[-3:]}", "nature": "NAISSANCE", "libelle": "Acte de naissance",
                                                            "lien": f"https://jury.test/f/{nin}"}]}


def client_de_test():
    return httpx.AsyncClient(timeout=5, mounts={
        "http://registres.test": httpx.ASGITransport(app=serveur.app),
        "http://externe.test": httpx.ASGITransport(app=externe),
        "http://usurpateur.test": httpx.ASGITransport(app=usurpateur),
        "http://jury.test": httpx.ASGITransport(app=jury),
    })


# ── Données de départ ────────────────────────────────────────────────────────
def roles(*entrees):
    return [{"id": f"R{i}", "iu": iu, "role": role, "service": service, "code": code, "statut": "actif", "par": "installation"}
            for i, (iu, role, service, code) in enumerate(entrees, 1)]


def installer():
    """Base minimale : un super admin, un admin et un agent de la Direction des passeports, une démarche,
    et le registre d'identité simulé branché (pour la connexion par code)."""
    stockage._RefMemoire.racine = {
        "socle": {
            "services": {s: {"nom": n, "statut": "actif"} for s, n in [
                ("direction-des-passeports", "Direction des passeports"), ("mairie-de-ouagadougou", "Mairie de Ouagadougou"),
                ("tribunal-de-ouagadougou", "Tribunal de grande instance"), ("registre-de-la-nationalite", "Registre de la nationalité")]},
            "roles": roles((SUPER_ADMIN, "super_admin", None, "SA-0001"),
                           (ADMIN_PASSEPORTS, "admin", "direction-des-passeports", "AD-0001"),
                           (AGENT_PASSEPORTS, "agent", "direction-des-passeports", "AG-0001")),
            "demarches": {"direction-des-passeports": {"DM-001": {
                "nom": "Demande de passeport", "finalite": "Délivrer un passeport", "base_legale": "Décret relatif aux titres de voyage",
                "pieces": ["acte_naissance", "certificat_nationalite", "casier_vierge", "majeur"], "duree": 30, "statut": "active"}}},
        },
        "branchements": {"registre-identite-simule": {
            "nom": "Registre d'identité simulé", "statut": "actif", "double_api": True, "secret": "secret-identite",
            "connexion": {"url_documents": f"{REGISTRES}/identite/documents", "url_verifier": f"{REGISTRES}/identite/verifier"}}},
    }
    identite.secret = "secret-identite"


_jetons: dict = {}


@pytest.fixture(autouse=True)
def environnement(monkeypatch):
    installer()
    _jetons.clear()
    module_session._cle = None
    monkeypatch.setattr(appels, "nouveau_client", client_de_test)
    for r in (etat_civil, justice, nationalite, identite):
        r.panne = False
        r.trace.clear()
    yield


@pytest.fixture
def socle():
    return TestClient(main.app)


@pytest.fixture
def registres():
    """Accès direct aux registres, comme le navigateur de l'agent qui ouvre un fichier."""
    return TestClient(serveur.app, base_url="http://registres.test")


# ── Actions courantes ────────────────────────────────────────────────────────
def connecter(socle, iu) -> dict:
    """Connexion par code à usage unique (une fois par personne et par test) ; renvoie l'en-tête d'autorisation."""
    if iu not in _jetons:
        code = socle.post("/session/code", json={"iu": iu}).json()["code_demo"]
        _jetons[iu] = socle.post("/session/ouvrir", json={"iu": iu, "code": code}).json()["jeton"]
    return {"Authorization": f"Bearer {_jetons[iu]}"}


def creer_service(socle, sid, nom, double_api=False):
    sa = connecter(socle, SUPER_ADMIN)
    return socle.post("/connect/services/secret", json={"id": sid, "nom": nom, "double_api": double_api}, headers=sa).json()["secret"]


def brancher_registre(socle, sid):
    """Branche l'un des registres simulés, avec toutes ses routes ; le registre reçoit le code généré par le socle."""
    registre, chemin = SERVICES[sid]
    secret = creer_service(socle, sid, registre.nom)
    registre.secret = secret
    base = f"{REGISTRES}/{chemin}"
    rep = socle.post("/connect/brancher", json={
        "service_id": sid, "secret": secret, "url_documents": f"{base}/documents", "url_predicat": f"{base}/predicat",
        "url_lien": f"{base}/lien", "url_catalogue": f"{base}/catalogue"})
    assert rep.status_code == 200, rep.text
    return rep.json()


def ouvrir_accord(socle, iu, dossier="D-0001", pieces=("acte_naissance", "certificat_nationalite", "casier_vierge", "majeur"),
                  service="direction-des-passeports", agent=AGENT_PASSEPORTS):
    entetes = connecter(socle, agent)
    rep = socle.post("/consentement/accords", headers=entetes, json={
        "dossier": dossier, "iu": iu, "service": service, "finalite": "Délivrer un passeport",
        "base_legale": "Décret relatif aux titres de voyage", "pieces": list(pieces), "duree": 30})
    assert rep.status_code == 200, rep.text
    return entetes, rep.json()


def lignes_passerelle(socle, iu):
    sa = connecter(socle, SUPER_ADMIN)
    return [l for l in socle.get("/journal", headers=sa).json() if l["casquette"] == "passerelle" and l.get("iu") == iu]
