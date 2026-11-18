"""Démonstration locale, prête à l'emploi : registres simulés + socle (en mémoire) + comptes de démonstration, tout branché.

Lancer depuis la racine du projet :  python3 outils/demo_locale.py      (Ctrl+C pour arrêter)
Prérequis : .venv avec backend/requirements.txt, et l'interface construite (cd espace-usager && npm ci && npm run build).
Rien n'est écrit sur le disque : à chaque lancement, on repart des mêmes données fictives.
"""
import signal
import sys
import time
from pathlib import Path

RACINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RACINE / "espace-usager" / "tests" / "e2e"))

if not (RACINE / "espace-usager" / "dist" / "index.html").exists():
    sys.exit("Construisez d'abord l'interface :  cd espace-usager && npm ci && npm run build")
if not (RACINE / ".venv" / "bin" / "python").exists():
    sys.exit("Créez d'abord l'environnement Python :  python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt")

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
