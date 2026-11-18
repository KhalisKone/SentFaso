"""Stockage libre : SQLite ou PostgreSQL (dont Supabase), avec la même arborescence JSON que Firebase.

Une seule table, `socle_donnees (chemin, valeur)` : chaque « document » de l'arbre (un dossier, une ligne du journal, un accord,
un service…) est une ligne, avec son chemin et son contenu JSON. Lire une branche rassemble les lignes qu'elle contient ;
écrire un chemin ne touche que la ligne concernée. Le reste du socle ne voit aucune différence : mêmes opérations
(get, set, delete, transaction) que firebase_admin.db.Reference.

Profondeur d'un document selon la branche (ex. socle/dossiers/D-0001 = une ligne). Une valeur qui n'est pas un objet
(liste, texte, nombre) est rangée telle quelle, plus haut si besoin. Les lignes ne se recouvrent jamais.
"""
import json
import threading
from pathlib import Path

PROFONDEUR = {"socle": 3, "journal": 2, "branchements": 2, "consentement": 3, "sessions": 3, "assistant": 4, "securite": 2}
TABLE = "socle_donnees"


def _sans_null(v):
    """Comme Firebase : les valeurs nulles et les objets vides disparaissent."""
    if isinstance(v, dict):
        propre = {k: _sans_null(x) for k, x in v.items()}
        return {k: x for k, x in propre.items() if x is not None} or None
    if isinstance(v, list):
        return [_sans_null(x) for x in v]
    return v


def _profondeur(segments: list[str]) -> int:
    return PROFONDEUR.get(segments[0], 1) if segments else 1


def _naviguer(valeur, segments):
    for s in segments:
        if isinstance(valeur, dict):
            valeur = valeur.get(s)
        elif isinstance(valeur, list) and s.isdigit() and int(s) < len(valeur):
            valeur = valeur[int(s)]
        else:
            return None
    return valeur


def _poser(valeur, segments, nouveau):
    """Renvoie `valeur` avec `nouveau` placé au chemin `segments` (None = suppression)."""
    if not segments:
        return nouveau
    base = valeur if isinstance(valeur, (dict, list)) else {}
    if isinstance(base, list):
        base = {str(i): x for i, x in enumerate(base)}
    base = dict(base)
    base[segments[0]] = _poser(base.get(segments[0]), segments[1:], nouveau)
    if base[segments[0]] is None:
        del base[segments[0]]
    return base or None


class Base:
    """Connexion unique protégée par un verrou (le socle tourne en un seul processus)."""

    verrou = threading.RLock()

    def __init__(self, url: str, ici: Path):
        self.url = url
        if url.startswith(("postgres://", "postgresql://")):
            import psycopg  # dépendance du seul mode postgres

            self.pg, self.psycopg = True, psycopg
            self.cx = None
            self._connecter()
        else:
            import sqlite3

            chemin = Path(url.removeprefix("sqlite:///").removeprefix("sqlite:"))
            chemin = chemin if chemin.is_absolute() else ici / chemin
            chemin.parent.mkdir(parents=True, exist_ok=True)
            self.pg, self.cx = False, sqlite3.connect(str(chemin), check_same_thread=False, isolation_level=None)
            self.cx.execute("PRAGMA journal_mode=WAL")
            self.cx.execute(f"CREATE TABLE IF NOT EXISTS {TABLE} (chemin TEXT PRIMARY KEY, valeur TEXT NOT NULL)")

    def _connecter(self):
        self.cx = self.psycopg.connect(self.url, autocommit=True, prepare_threshold=None)
        self.cx.execute(f"CREATE TABLE IF NOT EXISTS {TABLE} (chemin text PRIMARY KEY, valeur jsonb NOT NULL, maj timestamptz NOT NULL DEFAULT now())")

    def _sql(self, requete: str) -> str:
        return requete.replace("?", "%s") if self.pg else requete

    def executer(self, requete: str, parametres=(), lire=False):
        for essai in (1, 2):
            try:
                cur = self.cx.execute(self._sql(requete), parametres)
                return cur.fetchall() if lire else None
            except Exception as e:  # connexion PostgreSQL coupée (ex. pooler) : une reconnexion
                if not self.pg or essai == 2 or not isinstance(e, self.psycopg.OperationalError):
                    raise
                self._connecter()

    def debut(self):
        self.executer("BEGIN")

    def fin(self, ok: bool):
        self.executer("COMMIT" if ok else "ROLLBACK")

    # ── Lignes ──
    def ligne(self, chemin: str):
        r = self.executer(f"SELECT valeur FROM {TABLE} WHERE chemin = ?", (chemin,), lire=True)
        return (r[0][0] if self.pg else json.loads(r[0][0])) if r else None

    def sous(self, prefixe: str) -> list[tuple[str, object]]:
        if not prefixe:
            r = self.executer(f"SELECT chemin, valeur FROM {TABLE}", lire=True)
        else:
            p = prefixe + "/"
            r = self.executer(f"SELECT chemin, valeur FROM {TABLE} WHERE substr(chemin, 1, ?) = ?", (len(p), p), lire=True)
        return [(c, v if self.pg else json.loads(v)) for c, v in r]

    def ecrire(self, chemin: str, valeur):
        texte = json.dumps(valeur, ensure_ascii=False)
        if self.pg:
            self.executer(f"INSERT INTO {TABLE} (chemin, valeur, maj) VALUES (?, ?::jsonb, now()) "
                          f"ON CONFLICT (chemin) DO UPDATE SET valeur = excluded.valeur, maj = now()", (chemin, texte))
        else:
            self.executer(f"INSERT INTO {TABLE} (chemin, valeur) VALUES (?, ?) ON CONFLICT(chemin) DO UPDATE SET valeur = excluded.valeur",
                          (chemin, texte))

    def effacer(self, chemin: str, avec_sous: bool):
        self.executer(f"DELETE FROM {TABLE} WHERE chemin = ?", (chemin,))
        if avec_sous:
            p = chemin + "/" if chemin else ""
            if p:
                self.executer(f"DELETE FROM {TABLE} WHERE substr(chemin, 1, ?) = ?", (len(p), p))
            else:
                self.executer(f"DELETE FROM {TABLE}")


class RefSQL:
    """Référence à un chemin de l'arbre : get, set, delete, transaction (comme Firebase)."""

    base: Base | None = None

    def __init__(self, chemin: str):
        self.seg = [c for c in chemin.strip("/").split("/") if c]

    def _ancetre(self):
        """La ligne qui contient ce chemin (ou ce chemin lui-même), s'il y en a une : (segments, valeur)."""
        for d in range(1, min(len(self.seg), _profondeur(self.seg)) + 1):
            v = self.base.ligne("/".join(self.seg[:d]))
            if v is not None:
                return self.seg[:d], v
        return None

    def get(self):
        with Base.verrou:
            trouve = self._ancetre()
            if trouve:
                return _naviguer(trouve[1], self.seg[len(trouve[0]):])
            if len(self.seg) >= _profondeur(self.seg):
                return None
            arbre = None
            n = len(self.seg)
            for chemin, valeur in self.base.sous("/".join(self.seg)):
                arbre = _poser(arbre, chemin.split("/")[n:], valeur)
            return arbre

    def _ranger(self, segments, valeur):
        if valeur is None:
            return
        if segments and (len(segments) >= _profondeur(segments) or not isinstance(valeur, dict)):
            self.base.ecrire("/".join(segments), valeur)
            return
        for k, x in valeur.items():
            self._ranger([*segments, k], x)

    def _poser(self, valeur):
        """Trois cas : (1) le chemin est à l'intérieur d'une ligne → on modifie cette ligne ; (2) le chemin est une ligne →
        on la remplace ; (3) pas de ligne au-dessus → on crée le document, ou on remplace la branche (lignes en dessous)."""
        valeur = _sans_null(json.loads(json.dumps(valeur)))
        n, g = len(self.seg), _profondeur(self.seg)
        trouve = self._ancetre()
        if trouve and len(trouve[0]) < n:                       # (1)
            cle, contenu = trouve
            nouveau = _sans_null(_poser(contenu, self.seg[len(cle):], valeur))
            if nouveau is None:
                self.base.effacer("/".join(cle), False)
            else:
                self.base.ecrire("/".join(cle), nouveau)
        elif trouve:                                            # (2)
            self.base.effacer("/".join(self.seg), False)
            self._ranger(self.seg, valeur)
        elif n >= g:                                            # (3) document absent : création
            nouveau = _sans_null(_poser(None, self.seg[g:], valeur))
            if nouveau is not None:
                self.base.ecrire("/".join(self.seg[:g]), nouveau)
        else:                                                   # (3) branche : on remplace tout ce qu'elle contient
            self.base.effacer("/".join(self.seg), True)
            self._ranger(self.seg, valeur)

    def set(self, valeur):
        with Base.verrou:
            self.base.debut()
            try:
                self._poser(valeur)
            except BaseException:
                self.base.fin(False)
                raise
            self.base.fin(True)

    def delete(self):
        self.set(None)

    def transaction(self, fonction):
        with Base.verrou:
            self.base.debut()
            try:
                nouveau = fonction(self.get())
                self._poser(nouveau)
            except BaseException:
                self.base.fin(False)
                raise
            self.base.fin(True)
            return nouveau
