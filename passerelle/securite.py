"""Authentification mutuelle passerelle ↔ registre, par HMAC-SHA256 avec le code secret du service.

- Appel : X-Socle-Signature = HMAC(secret, horodatage + "\\n" + "GET" + "\\n" + chemin?requête)
- Réponse : X-Registre-Signature = HMAC(secret, horodatage + "\\n" + chemin?requête + "\\n" + SHA-256(corps))
Une signature de réponse fausse ou périmée est rejetée ; une réponse non signée est acceptée et marquée,
tant que SIGNATURE_REGISTRE_OBLIGATOIRE n'est pas à 1 (période de transition).
"""
import hashlib
import hmac
import os
import time
from urllib.parse import urlsplit

import httpx

FENETRE = 300
LIB_SIGNATURE = {"valide": "réponse signée et vérifiée", "absente": "réponse non signée"}


def signature_obligatoire() -> bool:
    return os.environ.get("SIGNATURE_REGISTRE_OBLIGATOIRE", "0") == "1"


class ReponseRejetee(Exception):
    """Réponse d'un registre refusée par la passerelle (signature fausse, absente ou périmée)."""


def chemin_de(url: str) -> str:
    u = urlsplit(url)
    return u.path + ("?" + u.query if u.query else "")


def entetes(service_id: str, secret: str, url: str) -> dict:
    """En-têtes signés que la passerelle joint à chaque appel."""
    ts = str(int(time.time()))
    signature = hmac.new(secret.encode(), f"{ts}\nGET\n{chemin_de(url)}".encode(), hashlib.sha256).hexdigest()
    return {"X-Socle-Service": service_id, "X-Socle-Horodatage": ts, "X-Socle-Signature": signature}


def signature_reponse(secret: str, ts: str, chemin: str, corps: bytes) -> str:
    message = f"{ts}\n{chemin}\n{hashlib.sha256(corps).hexdigest()}"
    return hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()


def controler_reponse(secret: str, chemin: str, r: httpx.Response) -> str:
    """Vérifie que la réponse vient bien du registre et n'a pas été modifiée. Renvoie « valide » ou « absente »."""
    recue, ts = r.headers.get("X-Registre-Signature"), r.headers.get("X-Registre-Horodatage", "")
    if not recue:
        if signature_obligatoire():
            raise ReponseRejetee("réponse non signée")
        return "absente"
    if not ts.isdigit() or abs(time.time() - int(ts)) > FENETRE:
        raise ReponseRejetee("horodatage de la réponse absent ou périmé")
    if not hmac.compare_digest(signature_reponse(secret, ts, chemin, r.content), recue):
        raise ReponseRejetee("signature de la réponse invalide")
    return "valide"
