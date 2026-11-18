"""Accès à la base du socle : une arborescence JSON, quelle que soit la base choisie dans backend/.env.

SOCLE_STOCKAGE=postgres : PostgreSQL, dont Supabase (DATABASE_URL=postgresql://…) — libre, hébergeable dans le pays.
SOCLE_STOCKAGE=sqlite   : un fichier (DATABASE_URL=chemin, défaut donnees/socle.db) — libre, rien à installer.
SOCLE_STOCKAGE=firebase : Firebase Realtime Database (FIREBASE_CREDENTIALS, FIREBASE_DB_URL) — réglage par défaut.
SOCLE_STOCKAGE=copie    : essais ; Firebase lu une fois, puis tout en mémoire (rien n'est réécrit).
SOCLE_STOCKAGE=memoire  : tests automatiques ; en mémoire, vide ou chargée depuis le fichier JSON SOCLE_GRAINE.
Avec postgres ou sqlite, SOCLE_GRAINE remplit aussi une base vide au premier démarrage.
"""
import copy
import json
import os
import threading
from pathlib import Path

ICI = Path(__file__).resolve().parent


def _charger_env():
    fichier = ICI / ".env"
    if fichier.exists():
        for ligne in fichier.read_text(encoding="utf-8").splitlines():
            if "=" in ligne and not ligne.lstrip().startswith("#"):
                cle, valeur = ligne.split("=", 1)
                os.environ.setdefault(cle.strip(), valeur.strip())


_charger_env()
MODE = os.environ.get("SOCLE_STOCKAGE", "firebase")
if MODE in ("firebase", "copie"):
    import firebase_admin
    from firebase_admin import credentials, db

    firebase_admin.initialize_app(
        credentials.Certificate(ICI / os.environ["FIREBASE_CREDENTIALS"]),
        {"databaseURL": os.environ["FIREBASE_DB_URL"]},
    )
elif MODE in ("postgres", "sqlite"):
    from stockage_sql import Base, RefSQL

    url = os.environ.get("DATABASE_URL") or ("donnees/socle.db" if MODE == "sqlite" else "")
    if not url:
        raise RuntimeError("SOCLE_STOCKAGE=postgres : indiquez DATABASE_URL (postgresql://…) dans backend/.env.")
    RefSQL.base = Base(url, ICI)
    if os.environ.get("SOCLE_GRAINE") and RefSQL("/").get() is None:
        RefSQL("/").set(json.loads(Path(os.environ["SOCLE_GRAINE"]).read_text(encoding="utf-8")))
elif MODE != "memoire":
    raise RuntimeError(f"SOCLE_STOCKAGE inconnu : {MODE} (postgres, sqlite, firebase, copie ou memoire).")


def _sans_null(v):
    """Comme Firebase : les valeurs nulles disparaissent."""
    if isinstance(v, dict):
        propre = {k: _sans_null(x) for k, x in v.items()}
        return {k: x for k, x in propre.items() if x is not None} or None
    if isinstance(v, list):
        return [_sans_null(x) for x in v]
    return v


class _RefMemoire:
    """Référence en mémoire qui imite l'API de firebase_admin.db.Reference (get, set, delete, transaction)."""

    racine: dict = {}
    verrou = threading.RLock()

    def __init__(self, chemin: str):
        self.cles = [c for c in chemin.strip("/").split("/") if c]

    def _parent(self, creer: bool):
        noeud = _RefMemoire.racine
        for c in self.cles[:-1]:
            if not isinstance(noeud, dict) or c not in noeud:
                if not creer:
                    return None
                noeud[c] = {}
            noeud = noeud[c]
        return noeud

    def get(self):
        with self.verrou:
            noeud = _RefMemoire.racine
            for c in self.cles:  # comme Firebase : un élément de liste se lit par son numéro
                if isinstance(noeud, dict):
                    noeud = noeud.get(c)
                elif isinstance(noeud, list) and c.isdigit() and int(c) < len(noeud):
                    noeud = noeud[int(c)]
                else:
                    return None
                if noeud is None:
                    return None
            return copy.deepcopy(noeud)

    def set(self, valeur):
        with self.verrou:
            valeur = _sans_null(json.loads(json.dumps(valeur)))
            if valeur is None:
                return self.delete()
            if not self.cles:  # racine de l'arbre
                _RefMemoire.racine = valeur if isinstance(valeur, dict) else {}
                return
            self._parent(True)[self.cles[-1]] = valeur

    def delete(self):
        with self.verrou:
            if not self.cles:
                _RefMemoire.racine = {}
                return
            noeuds = [_RefMemoire.racine]  # noeuds[i] = noeud au chemin cles[:i]
            for c in self.cles[:-1]:
                if not isinstance(noeuds[-1], dict) or c not in noeuds[-1]:
                    return
                noeuds.append(noeuds[-1][c])
            if isinstance(noeuds[-1], dict):
                noeuds[-1].pop(self.cles[-1], None)
            for i in range(len(noeuds) - 1, 0, -1):  # comme Firebase : une branche devenue vide disparaît
                if isinstance(noeuds[i], dict) and not noeuds[i]:
                    del noeuds[i - 1][self.cles[i - 1]]
                else:
                    break

    def transaction(self, fonction):
        with self.verrou:
            nouveau = fonction(self.get())
            self.set(nouveau)
            return nouveau


if MODE == "copie":
    _RefMemoire.racine = db.reference("/").get() or {}
elif MODE == "memoire" and os.environ.get("SOCLE_GRAINE"):
    # Données de départ (tests de bout en bout) : un fichier JSON avec la même arborescence que la base.
    _RefMemoire.racine = json.loads(Path(os.environ["SOCLE_GRAINE"]).read_text(encoding="utf-8"))


def ref(chemin: str):
    if MODE == "firebase":
        return db.reference(chemin)
    if MODE in ("postgres", "sqlite"):
        return RefSQL(chemin)
    return _RefMemoire(chemin)
