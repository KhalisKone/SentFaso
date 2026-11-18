"""Transférer les données du socle vers une base libre (PostgreSQL / Supabase, ou SQLite), sans couper le site.

Lancer depuis backend/ :
  python3 ../outils/transferer_base.py --vers postgresql://socle_app.<ref>:<mot de passe>@<hôte>:5432/postgres
  python3 ../outils/transferer_base.py --vers donnees/socle.db                       # SQLite
  python3 ../outils/transferer_base.py --exporter sauvegarde.json                   # copie de sécurité JSON, sans transfert
  python3 ../outils/transferer_base.py --depuis sauvegarde.json --vers <base>       # depuis une copie JSON

Source par défaut : Firebase (FIREBASE_CREDENTIALS et FIREBASE_DB_URL, lus dans backend/.env). Rien n'est modifié dans la source.
La destination doit être vide (sinon --remplacer). Le transfert est vérifié : tout ce qui a été écrit est relu et comparé.
Ensuite : SOCLE_STOCKAGE=postgres (ou sqlite) et DATABASE_URL dans backend/.env, puis redémarrer le socle.
Le mot de passe de la base n'est jamais affiché.
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND))
from stockage_sql import Base, RefSQL, _sans_null  # noqa: E402


def charger_env():
    fichier = BACKEND / ".env"
    if fichier.exists():
        for ligne in fichier.read_text(encoding="utf-8").splitlines():
            if "=" in ligne and not ligne.lstrip().startswith("#"):
                cle, valeur = ligne.split("=", 1)
                os.environ.setdefault(cle.strip(), valeur.strip())


def lire_firebase() -> dict:
    import firebase_admin
    from firebase_admin import credentials, db

    firebase_admin.initialize_app(credentials.Certificate(BACKEND / os.environ["FIREBASE_CREDENTIALS"]),
                                  {"databaseURL": os.environ["FIREBASE_DB_URL"]})
    return db.reference("/").get() or {}


def masquer(url: str) -> str:
    return re.sub(r"(://[^:/@]+:)[^@]+@", r"\1***@", url)


def resume(arbre: dict) -> str:
    return ", ".join(f"{k} : {len(v) if isinstance(v, (dict, list)) else 1}" for k, v in sorted(arbre.items()))


def main():
    a = argparse.ArgumentParser(description="Transférer les données du socle vers une base libre.")
    a.add_argument("--vers", help="destination : postgresql://… ou chemin d'un fichier SQLite")
    a.add_argument("--depuis", help="source : copie JSON (par défaut : Firebase)")
    a.add_argument("--exporter", help="écrire une copie JSON de la source dans ce fichier")
    a.add_argument("--remplacer", action="store_true", help="vider la destination si elle contient déjà des données")
    o = a.parse_args()
    if not (o.vers or o.exporter):
        a.error("indiquez --vers et/ou --exporter")

    charger_env()
    arbre = json.loads(Path(o.depuis).read_text(encoding="utf-8")) if o.depuis else lire_firebase()
    arbre = _sans_null(json.loads(json.dumps(arbre))) or {}
    print(f"Source ({o.depuis or 'Firebase'}) : {resume(arbre)}")

    if o.exporter:
        Path(o.exporter).write_text(json.dumps(arbre, ensure_ascii=False, indent=1), encoding="utf-8")
        os.chmod(o.exporter, 0o600)  # contient les codes des services : lisible par vous seul
        print(f"Copie JSON écrite : {o.exporter} (lisible par vous seul)")
    if not o.vers:
        return

    RefSQL.base = Base(o.vers, BACKEND)
    if RefSQL("/").get() and not o.remplacer:
        sys.exit(f"La destination {masquer(o.vers)} contient déjà des données : relancez avec --remplacer pour la vider.")
    RefSQL("/").set(arbre)
    relu = RefSQL("/").get() or {}
    if relu != arbre:
        sys.exit("ÉCHEC de la vérification : la destination ne correspond pas à la source. Ne basculez pas le site.")
    print(f"Transféré et vérifié vers {masquer(o.vers)} : {resume(relu)}")
    mode = "postgres" if o.vers.startswith(("postgres://", "postgresql://")) else "sqlite"
    print(f"Pour basculer : SOCLE_STOCKAGE={mode} et DATABASE_URL=… dans backend/.env, puis redémarrer le socle.")


if __name__ == "__main__":
    main()
