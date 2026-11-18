"""Stockage libre (SQLite, PostgreSQL / Supabase) : exactement le même comportement que la base de référence en mémoire
(qui imite Firebase). Le même scénario est joué sur les deux ; l'état complet est comparé après chaque étape.

PostgreSQL : lancer avec TEST_POSTGRES_URL=postgresql://… (sinon ce cas est sauté)."""
import os

import pytest

import stockage
from stockage_sql import Base, RefSQL

GRAINE = {
    "socle": {
        "services": {"oni": {"nom": "ONI", "statut": "actif"}, "mairie_de_test": {"nom": "Mairie", "statut": "actif"}},
        "roles": [{"id": "R1", "iu": "99000000000000001", "role": "super_admin", "service": None}],
        "dossiers": {"D-0001": {"statut": "autorise", "pieces": {"acte_naissance": {"statut": "fournie", "source": "mairie"}}}},
        "seq": {"role": 1, "dossier": 1},
    },
    "journal": {"L0000001": {"id": 1, "action": "Connexion", "hash": "h1"}},
    "journal_sceau": {"total": 1, "dernier_hash": "h1"},
    "branchements": {"oni": {"nom": "ONI", "secret": "s", "connexion": None, "catalogue": {"types": ["cnib"]}}},
    "consentement": {"accords": {"D-0001": {"statut": "actif", "pieces": ["acte_naissance"]}}},
    "assistant": {"conversations": {"99": {"C1": {"titre": "t", "fil": [{"role": "user", "texte": "bonjour"}]}}}},
    "securite": {"cle_session": "cle-1"},
    "installation": {"roles": {"R1": {"iu": "99000000000000001"}}},
}

SCENARIO = [
    ("set", "/", GRAINE),
    ("get", "socle"), ("get", "socle/dossiers/D-0001"), ("get", "socle/roles"), ("get", "journal"),
    ("get", "socle/dossiers/D-9999"), ("get", "inexistant"), ("get", "socle/dossiers/D-0001/pieces/acte_naissance/statut"),
    ("set", "socle/dossiers/D-0001/statut", "clos"),
    ("set", "socle/dossiers/D-0002", {"statut": "autorise", "iu": "99000000000000036"}),
    ("set", "socle/roles", [{"id": "R1", "iu": "1", "role": "super_admin"}, {"id": "R2", "iu": "2", "role": "agent", "service": "oni"}]),
    ("get", "socle/roles/1"),
    ("set", "socle/personnes/99000000000000036", {"nom": "TAPSOBA", "prenoms": "Alimata"}),
    ("set", "journal/L0000002", {"id": 2, "action": "Dossier ouvert", "hash": "h2"}),
    ("transaction", "journal_sceau", lambda s: {**(s or {}), "total": (s or {}).get("total", 0) + 1, "dernier_hash": "h2"}),
    ("set", "sessions/codes/99", {"hash": "x", "essais": 0}),
    ("set", "sessions/codes/99/essais", 1),
    ("get", "sessions/codes/99"),
    ("delete", "sessions/codes/99"),
    ("set", "socle", {**GRAINE["socle"], "services": {"oni": {"nom": "Office national d'identification", "statut": "actif"}}}),
    ("delete", "branchements/oni"),
    ("set", "assistant/index/99/C1", {"titre": "t", "messages": 2}),
    ("delete", "assistant/conversations/99/C1"),
    ("set", "socle/dossiers/D-0001/pieces", {}),
    ("set", "securite/cle_session", "cle-2"),
    ("set", "socle/seq/role", 5),
    ("set", "consentement/accords/D-0001/statut", "clos"),
    ("set", "socle/services/oni/tutelle", None),
    ("transaction", "socle/seq", lambda s: {**(s or {}), "dossier": (s or {}).get("dossier", 0) + 1}),
    ("set", "installation", None),
]


def jouer(fabrique):
    sorties = []
    for op, chemin, *val in SCENARIO:
        r = fabrique(chemin)
        if op == "get":
            sorties.append((chemin, r.get()))
        elif op == "set":
            r.set(val[0])
        elif op == "delete":
            r.delete()
        elif op == "transaction":
            sorties.append((chemin, r.transaction(val[0])))
        sorties.append(("état après " + op + " " + chemin, fabrique("/").get()))
    return sorties


def reference():
    stockage._RefMemoire.racine = {}
    return jouer(stockage._RefMemoire)


def comparer(base: Base):
    ancienne = RefSQL.base
    RefSQL.base = base
    try:
        RefSQL("/").delete()
        obtenu = jouer(RefSQL)
    finally:
        RefSQL.base = ancienne
    for (etape, attendu), (_, recu) in zip(reference(), obtenu):
        assert recu == attendu, f"différence à l'étape « {etape} »"


def test_sqlite_se_comporte_comme_la_reference(tmp_path):
    comparer(Base(str(tmp_path / "socle.db"), tmp_path))


def test_sqlite_garde_les_donnees_apres_redemarrage(tmp_path):
    ancienne = RefSQL.base
    try:
        RefSQL.base = Base(str(tmp_path / "socle.db"), tmp_path)
        RefSQL("/").set(GRAINE)
        RefSQL.base = Base(str(tmp_path / "socle.db"), tmp_path)  # nouvelle connexion, même fichier
        assert RefSQL("socle/dossiers/D-0001/statut").get() == "autorise" and RefSQL("journal_sceau/total").get() == 1
    finally:
        RefSQL.base = ancienne


@pytest.mark.skipif(not os.environ.get("TEST_POSTGRES_URL"), reason="TEST_POSTGRES_URL non fourni")
def test_postgresql_se_comporte_comme_la_reference(tmp_path):
    comparer(Base(os.environ["TEST_POSTGRES_URL"], tmp_path))
