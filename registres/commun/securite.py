"""Sécurité d'un registre : vérifier que l'appel vient du socle, signer ses réponses, signer les liens vers les fichiers.

Le contrat (page /frontend/connect du socle) :
- appel du socle : X-Socle-Signature = HMAC(secret, horodatage + "\\n" + "GET" + "\\n" + chemin?requête)
- réponse du registre : X-Registre-Signature = HMAC(secret, horodatage + "\\n" + chemin?requête + "\\n" + SHA-256(corps))
"""
import hashlib
import hmac
import json
import time

from fastapi import HTTPException, Request, Response

FENETRE = 300  # secondes de tolérance sur l'horodatage


def chemin(req: Request) -> str:
    """Chemin et requête tels que l'appelant les a signés (préfixe de montage compris)."""
    return req.url.path + ("?" + req.url.query if req.url.query else "")


def verifier_appel(req: Request, secret: str) -> str:
    """Refuse (401) tout appel dont la signature est fausse ou périmée. Renvoie l'identifiant du service appelant."""
    ts = req.headers.get("X-Socle-Horodatage", "")
    recue = req.headers.get("X-Socle-Signature", "")
    attendue = hmac.new(secret.encode(), f"{ts}\nGET\n{chemin(req)}".encode(), hashlib.sha256).hexdigest()
    if not ts.isdigit() or abs(time.time() - int(ts)) > FENETRE or not hmac.compare_digest(attendue, recue):
        raise HTTPException(401, "Appel non authentifié.")
    return req.headers.get("X-Socle-Service", "")


def reponse_signee(req: Request, donnees, secret: str, statut: int = 200) -> Response:
    """Réponse JSON signée : la passerelle vérifie qu'elle vient bien de ce registre et n'a pas été modifiée."""
    corps = json.dumps(donnees, ensure_ascii=False).encode()
    ts = str(int(time.time()))
    message = f"{ts}\n{chemin(req)}\n{hashlib.sha256(corps).hexdigest()}"
    signature = hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()
    return Response(corps, status_code=statut, media_type="application/json",
                    headers={"X-Registre-Horodatage": ts, "X-Registre-Signature": signature})


def signer_lien(secret: str, document: str, iu: str, expire: int) -> str:
    return hmac.new(secret.encode(), f"fichier\n{document}\n{iu}\n{expire}".encode(), hashlib.sha256).hexdigest()


def verifier_lien(secret: str, document: str, iu: str, expire: str, sig: str):
    if not expire.isdigit() or int(expire) < time.time():
        raise HTTPException(403, "Lien expiré : redemandez la pièce depuis le dossier.")
    if not hmac.compare_digest(signer_lien(secret, document, iu, int(expire)), sig or ""):
        raise HTTPException(403, "Lien invalide.")
