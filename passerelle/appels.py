"""Appels de la passerelle vers les registres : requête signée, contexte transmis, réponse vérifiée et adaptée."""
import hashlib
from urllib.parse import quote, urlencode

import httpx

from passerelle import adaptateur as adapt
from passerelle.securite import chemin_de, controler_reponse, entetes

DELAI = 8  # secondes : un registre plus lent est considéré comme indisponible


def nouveau_client() -> httpx.AsyncClient:
    """Client HTTP des appels sortants (remplacé dans les tests pour joindre des registres en mémoire)."""
    return httpx.AsyncClient(timeout=DELAI)


class Refus(Exception):
    """Le registre a refusé l'appel (403) : ses règles n'autorisent pas ce demandeur."""


async def appeler(client: httpx.AsyncClient, service_id: str, secret: str, url: str, params: dict,
                  adaptateur: dict | None = None, quoi: str = "") -> tuple[object, dict]:
    """Appelle un registre. Renvoie (réponse au format commun, preuve) ; preuve = état de la signature, empreinte du corps.

    Les paramètres vides sont omis ; le contexte (demandeur, dossier, finalité) fait partie de l'URL, donc de la signature.
    """
    reglages = adapt.completer(adaptateur)
    q = {k: v for k, v in params.items() if v not in (None, "")}
    if "{iu}" in url and "iu" in q:  # adresse du type /personnes/{iu}
        url = url.replace("{iu}", quote(str(q.pop("iu")), safe=""))
    if "iu" in q and reglages["parametre_iu"] != "iu":
        q[reglages["parametre_iu"]] = q.pop("iu")
    complet = f"{url}?{urlencode(q)}" if q else url
    r = await client.get(complet, headers=entetes(service_id, secret, complet))
    if r.status_code == 403:
        try:
            detail = r.json().get("detail")
        except Exception:
            detail = None
        raise Refus(detail or "accès refusé par le registre")
    r.raise_for_status()
    signature = controler_reponse(secret, chemin_de(complet), r)
    donnees = r.json()
    if quoi == "documents":
        donnees = adapt.documents(donnees, adaptateur)
    elif quoi == "verifier":
        donnees = adapt.verification(donnees, adaptateur)
    return donnees, {"signature": signature, "empreinte": hashlib.sha256(r.content).hexdigest()}
