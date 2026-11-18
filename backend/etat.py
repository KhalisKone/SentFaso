"""État du socle (services, rôles, démarches, dossiers), conservé dans Firebase sous /socle.

Lecture et écriture réservées aux personnes connectées, filtrées par leurs rôles (voir acces.py).
Le journal (couche journal) et les accords (couche consentement) n'en font pas partie : ils ont leurs propres API.
"""
from fastapi import APIRouter, Body, Depends

from acces import fusionner, vue
from consentement import accords_et_preferences
from session import Personne, personne
from stockage import ref

router = APIRouter(prefix="/etat", tags=["etat"])


@router.get("", summary="État visible par la personne connectée")
def lire(p: Personne = Depends(personne)):
    etat = ref("socle").get() or {}
    if not etat.get("roles"):
        etat["roles"] = [{"id": k, **v} for k, v in ((ref("installation").get() or {}).get("roles") or {}).items()]
    accords, preferences = accords_et_preferences()
    return vue(etat, p, accords, preferences)


@router.put("", summary="Enregistrer les modifications permises à la personne connectée")
def ecrire(etat: dict = Body(...), p: Personne = Depends(personne)):
    actuel = ref("socle").get() or {}
    if not actuel.get("roles"):
        actuel["roles"] = [{"id": k, **v} for k, v in ((ref("installation").get() or {}).get("roles") or {}).items()]
    nouveau, refus = fusionner(actuel, etat, p)
    nouveau.pop("journal", None)
    ref("socle").set(nouveau)
    return {"ok": True, "refus": refus}
