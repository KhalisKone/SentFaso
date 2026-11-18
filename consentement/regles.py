"""Règles du consentement et de la minimisation (fonctions pures, sans stockage ni réseau).

Un accord lie : un citoyen, un dossier, un service demandeur, une finalité, une base légale, une liste fermée
de pièces, une durée. Pas d'accord actif, pas d'accès : la passerelle refuse tout échange hors de ce cadre.
"""
from datetime import datetime, timedelta, timezone


def maintenant() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def nouvel_accord(*, dossier, iu, service, agent, finalite, base_legale, pieces, duree, requis) -> dict:
    """Accord à l'ouverture du dossier : actif d'emblée, ou en attente si le citoyen a demandé à donner son accord."""
    debut = datetime.now(timezone.utc)
    return {
        "dossier": dossier, "iu": iu, "service": service, "agent": agent, "finalite": finalite, "base_legale": base_legale,
        "pieces": list(dict.fromkeys(pieces)), "requis": requis, "statut": "en_attente" if requis else "actif",
        "le": maintenant(), "expire": (debut + timedelta(days=int(duree or 30))).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "historique": [{"le": maintenant(), "action": "ouvert", "par": agent}],
    }


TRANSITIONS = {  # l'accord est actif dès l'ouverture ; seul l'agent y met fin (clôture)
    "clore": ({"actif", "en_attente"}, "clos"),
}


def appliquer(accord: dict, action: str, par: str) -> dict:
    depuis, vers = TRANSITIONS[action]
    if accord["statut"] not in depuis:
        raise ValueError(f"Impossible de « {action} » un accord « {accord['statut']} ».")
    return {**accord, "statut": vers, "le": maintenant(),
            "historique": [*accord.get("historique", []), {"le": maintenant(), "action": action, "par": par}]}


def expire(accord: dict) -> bool:
    return datetime.fromisoformat(accord["expire"].replace("Z", "+00:00")) < datetime.now(timezone.utc)


def controler(accord: dict | None, *, iu: str, demandeur: str, codes: list[str]) -> list[str]:
    """Contrôle avant tout échange. Renvoie les codes autorisés (minimisation : seulement ceux de l'accord).
    Lève PermissionError avec le motif si l'échange n'est pas couvert."""
    if not accord:
        raise PermissionError("aucun accord pour ce dossier")
    if accord["iu"] != iu:
        raise PermissionError("l'accord ne concerne pas cette personne")
    if accord["service"] != demandeur:
        raise PermissionError("l'accord n'a pas été donné à ce service")
    if accord["statut"] != "actif":
        raise PermissionError(f"accord {accord['statut'].replace('_', ' ')}")
    if expire(accord):
        raise PermissionError("accord expiré")
    permis = [c for c in codes if c in accord["pieces"]]
    if codes and not permis:
        raise PermissionError("pièce non couverte par l'accord")
    return permis
