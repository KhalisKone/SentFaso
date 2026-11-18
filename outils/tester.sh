#!/usr/bin/env bash
# Lance tous les tests, couche par couche, sans Firebase ni réseau extérieur.
# Depuis la racine du projet :  outils/tester.sh            (E2E=0 pour sauter le test dans le navigateur)
set -e
cd "$(dirname "$0")/.."
PY=.venv/bin/python
for couche in registres passerelle consentement journal assistant backend; do
  echo "── ${couche} ──"
  $PY -m pytest "$couche/tests" -q -p no:cacheprovider -W ignore::DeprecationWarning
done
echo "── espace-usager : tests unitaires ──"
(cd espace-usager && npx vitest run)
if [ "${E2E:-1}" != "0" ]; then
  echo "── espace-usager : parcours de bout en bout (navigateur) ──"
  (cd espace-usager && npm run build --silent >/dev/null)
  python3 espace-usager/tests/e2e/parcours.py
fi
