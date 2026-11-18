"""Journal de traçabilité : unique, chaîné par SHA-256, en ajout seul, tenu par le serveur (Firebase /journal).

- Chaque ligne contient l'empreinte de la précédente : modifier une ligne casse la chaîne.
- Le sceau (/journal_sceau) garde le nombre de lignes et la dernière empreinte : supprimer une ligne se voit aussi.
- Les échanges avec les registres sont inscrits par la passerelle elle-même (casquette « passerelle ») :
  aucun navigateur ne peut écrire une ligne à sa place.
"""
import hashlib
import json
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException

from session import Personne, personne
from stockage import ref

router = APIRouter(prefix="/journal", tags=["journal"])

CHAMPS = ["id", "ts", "auteur", "code", "casquette", "action", "cible", "iu", "service", "resultat", "details"]
ZERO = "0" * 64
LONGUEUR_MAX = 600
CASQUETTES_RESERVEES = {"passerelle"}
CASQUETTES_ROLES = {"agent", "admin", "super_admin"}


def cle(numero: int) -> str:
    """Clé d'une ligne. Le préfixe évite que Firebase relise le journal comme une liste."""
    return f"journal/L{numero:07d}"


def maintenant() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def empreinte(ligne: dict) -> str:
    """Même calcul que l'interface : JSON des champs dans l'ordre (absents = null), suivi de l'empreinte précédente."""
    contenu = {c: ligne.get(c) for c in CHAMPS}
    texte = json.dumps(contenu, ensure_ascii=False, separators=(",", ":")) + ligne["prev"]
    return hashlib.sha256(texte.encode("utf-8")).hexdigest()


def ajouter(entree: dict) -> dict:
    """Ajoute une ligne en fin de chaîne. Le numéro, l'heure et les empreintes sont fixés par le serveur."""
    ts = maintenant()
    champs = {}
    for c in CHAMPS[2:]:
        v = entree.get(c)
        champs[c] = str(v)[:LONGUEUR_MAX] if v is not None else None
    champs["resultat"] = champs["resultat"] or "réussi"
    resultat = {}

    def sceller(sceau):
        sceau = sceau or {"total": 0, "dernier_hash": ZERO}
        ligne = {"id": sceau["total"] + 1, "ts": ts, **champs, "prev": sceau["dernier_hash"]}
        ligne["hash"] = empreinte(ligne)
        resultat.clear()
        resultat.update(ligne)
        return {"total": ligne["id"], "dernier_hash": ligne["hash"]}

    ref("journal_sceau").transaction(sceller)
    ref(cle(resultat["id"])).set(resultat)
    return {k: v for k, v in resultat.items() if v is not None}


def lignes(iu: str | None = None) -> list[dict]:
    brut = ref("journal").get() or {}
    tout = sorted((x for x in (brut.values() if isinstance(brut, dict) else brut) if x), key=lambda x: x["id"])
    return [x for x in tout if x.get("iu") == iu] if iu else tout


def verifier() -> dict:
    prev, tout = ZERO, lignes()
    for l in tout:
        if l.get("prev") != prev or empreinte(l) != l.get("hash"):
            return {"ok": False, "ligne": l["id"], "raison": "ligne modifiée ou chaîne rompue"}
        prev = l["hash"]
    sceau = ref("journal_sceau").get() or {"total": 0, "dernier_hash": ZERO}
    if sceau["total"] != len(tout) or sceau["dernier_hash"] != prev:
        return {"ok": False, "ligne": len(tout) + 1, "raison": f"lignes supprimées : le sceau en annonce {sceau['total']}, il en reste {len(tout)}"}
    return {"ok": True, "total": len(tout)}


def migrer_journal_navigateur():
    """Reprise unique de l'ancien journal (écrit par le navigateur dans /socle/journal), empreintes conservées."""
    if ref("journal_sceau").get() is not None:
        return
    ancien = ref("socle/journal").get() or []
    ancien = sorted((x for x in (ancien.values() if isinstance(ancien, dict) else ancien) if x), key=lambda x: x["id"])
    for l in ancien:
        ref(cle(l["id"])).set({c: l.get(c) for c in [*CHAMPS, "prev", "hash"]})
    ref("journal_sceau").set({"total": len(ancien), "dernier_hash": ancien[-1]["hash"] if ancien else ZERO})


# ── API ──────────────────────────────────────────────────────────────────────
def visible(l: dict, p: Personne) -> bool:
    """Le citoyen voit ce qui concerne ses données ; l'agent ses actions ; l'admin l'administration de son service ;
    le super admin tout (sans contenu de dossier : le journal ne contient que des références)."""
    if p.super_admin or l.get("iu") == p.iu or l.get("auteur") == p.iu:
        return True
    return l.get("service") in p.services("admin") and (l.get("casquette") == "admin" or "refus" in (l.get("action") or "").lower())


@router.get("", summary="Lignes du journal visibles par la personne connectée")
def lire(p: Personne = Depends(personne)):
    return [l for l in lignes() if visible(l, p)]


@router.post("", summary="Ajouter une ligne (l'auteur est la personne connectée)")
def ecrire(entree: dict = Body(...), p: Personne = Depends(personne)):
    if not entree.get("action"):
        raise HTTPException(400, "Action manquante.")
    casquette = entree.get("casquette") or "citoyen"
    if casquette in CASQUETTES_RESERVEES:
        raise HTTPException(403, "Cette casquette est réservée à la passerelle.")
    ligne = {**entree, "auteur": p.iu, "casquette": casquette}
    if casquette in CASQUETTES_ROLES:
        role = p.role(casquette, entree.get("service")) or p.role(casquette)
        if not role:
            raise HTTPException(403, f"Vous n'avez pas le rôle « {casquette} ».")
        ligne.update(code=role.get("code"), service=role.get("service"))
    elif casquette == "citoyen":
        ligne["code"] = None
    return ajouter(ligne)


@router.get("/verifier", summary="Vérifier l'intégrité de la chaîne et du sceau")
def controler():
    return verifier()


@router.post("/demo/falsifier", summary="Démonstration : modifier une ligne en base (super admin, désactivable)")
def falsifier(p: Personne = Depends(personne)):
    """Modifie une ligne directement en base, comme le ferait un attaquant. Désactivée si SOCLE_DEMO=0."""
    if os.environ.get("SOCLE_DEMO", "1") == "0" or not p.super_admin:
        raise HTTPException(404)
    tout = lignes()
    cible = next((l for l in tout if l.get("action") == "Pièce consultée"), tout[len(tout) // 2] if tout else None)
    if not cible:
        raise HTTPException(400, "Journal vide.")
    ref(f"{cle(cible['id'])}/details").set(f"{cible.get('details') or ''} [modifié en base]")
    return {"id": cible["id"]}
