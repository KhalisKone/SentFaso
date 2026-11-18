"""Démonstration locale en une commande : installe ce qui manque, puis lance registres simulés + socle (en mémoire) +
comptes de démonstration, tout branché.

Lancer depuis la racine du projet :  python3 outils/demo_locale.py      (Ctrl+C pour arrêter)
Prérequis : Python 3.12 et Node.js 18+. Au premier lancement, la commande crée .venv (backend/requirements.txt) et construit
l'interface (espace-usager/dist) ; les lancements suivants démarrent directement.
Rien n'est écrit dans les données : à chaque lancement, on repart des mêmes données fictives.
"""
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

RACINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RACINE / "espace-usager" / "tests" / "e2e"))


def etape(message, commande, dossier=RACINE):
    """Lance une étape d'installation ; s'arrête avec un message clair si elle échoue."""
    print(f"→ {message}…", flush=True)
    if subprocess.run(commande, cwd=dossier).returncode:
        sys.exit(f"Échec : {message}. Commande : {' '.join(map(str, commande))}")


def installer():
    """Première fois seulement : environnement Python et interface construite."""
    venv = RACINE / ".venv"
    if not (venv / "bin" / "python").exists():
        etape("Création de l'environnement Python (.venv)", [sys.executable, "-m", "venv", str(venv)])
        etape("Installation des dépendances Python", [str(venv / "bin" / "python"), "-m", "pip", "install", "-q",
                                                      "-r", str(RACINE / "backend" / "requirements.txt")])
    interface = RACINE / "espace-usager"
    if not (interface / "dist" / "index.html").exists():
        npm = shutil.which("npm")
        if not npm:
            sys.exit("Node.js 18+ (avec npm) est nécessaire pour construire l'interface : https://nodejs.org")
        if not (interface / "node_modules").is_dir():
            etape("Installation des dépendances de l'interface", [npm, "ci", "--no-audit", "--no-fund"], interface)
        etape("Construction de l'interface", [npm, "run", "build", "--silent"], interface)


installer()

import parcours as p  # noqa: E402  (même installation que le test de bout en bout)

COMPTES = [
    ("Super admin", "99000000000000001"),
    ("Admin — Direction des passeports / ONI / Fonction publique", "99000000000000021 / 022 / 023"),
    ("Agent — Direction des passeports / ONI / Fonction publique", "99000000000000033 / 034 / 035"),
    ("Citoyen sans aucune pièce à fournir", "99000000000000036 (ou 99000000000000001)"),
    ("Citoyen : acte détenu par deux registres (à choisir)", "99000000000000010"),
    ("Citoyen : aucun acte de naissance (à fournir)", "99000000000000025"),
]

sys.stdout.reconfigure(line_buffering=True)
signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt))  # arrêt propre aussi sur SIGTERM
procs = p.demarrer()
try:
    print(f"\nSocle prêt : {p.SOCLE}/frontend/   (documentation de l'API : {p.SOCLE}/docs)")
    print(f"Page de branchement des registres : {p.SOCLE}/frontend/connect")
    print("Connexion : code unique, puis le code à 6 chiffres affiché à l'écran (démonstration).\n")
    for role, code in COMPTES:
        print(f"  {role:<62} {code}")
    print(f"\nPanne d'un registre : {p.REG}/etat-civil/console?jeton=e2e → « Simuler une panne ».")
    print("Ctrl+C pour arrêter.")
    while all(pr.poll() is None for pr in procs):
        time.sleep(1)
    print("Un des serveurs s'est arrêté.")
except KeyboardInterrupt:
    print("\nArrêt.")
finally:
    for pr in procs:
        pr.terminate()
