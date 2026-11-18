"""Exporte une spécification OpenAPI par couche dans livrables/specifications-openapi/.

  registre-*.json        couche registres (contrat commun, implémenté par chaque registre simulé)
  passerelle.json        couche passerelle d'échange (/connect)
  consentement.json      couche consentement et minimisation (/consentement)
  journal.json           couche journal de traçabilité (/journal)
  espace-usager.json     API utilisée par l'espace usager (/session, /etat)
  assistant.json         assistant conversationnel (bonus, /assistant)
  socle-complet.json     toutes les routes du socle

Lancer depuis la racine du projet :  .venv/bin/python outils/exporter_openapi.py  (mode mémoire : aucun accès à Firebase)
"""
import json
import os
import sys
from pathlib import Path

from fastapi import FastAPI

RACINE = Path(__file__).resolve().parents[1]
os.environ["SOCLE_STOCKAGE"] = "memoire"
for prefixe in ("ETAT_CIVIL", "JUSTICE", "NATIONALITE", "IDENTITE"):
    os.environ.setdefault(f"{prefixe}_SECRET", "export")
sys.path[:0] = [str(RACINE / "backend"), str(RACINE / "registres"), str(RACINE)]

import main  # noqa: E402
from assistant import router as assistant  # noqa: E402
from consentement import router as consentement  # noqa: E402
from etat import router as etat  # noqa: E402
from etat_civil.app import app as etat_civil  # noqa: E402
from identite.app import app as identite  # noqa: E402
from journal import router as journal  # noqa: E402
from justice.app import app as justice  # noqa: E402
from nationalite.app import app as nationalite  # noqa: E402
from passerelle.api import router as passerelle  # noqa: E402
from session import router as session  # noqa: E402

SORTIE = RACINE / "livrables" / "specifications-openapi"
SORTIE.mkdir(parents=True, exist_ok=True)

SIGNATURE = {"AppelSigne": {"type": "apiKey", "in": "header", "name": "X-Socle-Signature", "description":
    "HMAC-SHA256(code secret, horodatage + \"\\n\" + \"GET\" + \"\\n\" + chemin?requête), avec X-Socle-Service et X-Socle-Horodatage. "
    "La réponse porte X-Registre-Horodatage et X-Registre-Signature = HMAC-SHA256(code secret, horodatage + \"\\n\" + chemin?requête + \"\\n\" + SHA-256(corps))."}}
SESSION = {"Session": {"type": "http", "scheme": "bearer", "description": "Jeton obtenu par /session/ouvrir (identifiant unique + code à usage unique)."}}


def couche(titre, description, *routeurs):
    app = FastAPI(title=titre, version="2.0", description=description)
    for r in routeurs:
        app.include_router(r)
    return app


def ecrire(nom, app, securite=None, routes_signees=()):
    spec = app.openapi()
    if securite:
        spec.setdefault("components", {})["securitySchemes"] = securite
        cle = next(iter(securite))
        for chemin, operations in spec["paths"].items():
            if not routes_signees or chemin.split("/")[1] in routes_signees:
                for op in operations.values():
                    op["security"] = [{cle: []}]
    (SORTIE / f"{nom}.json").write_text(json.dumps(spec, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"livrables/specifications-openapi/{nom}.json : {len(spec['paths'])} routes")


for nom, app in [("etat-civil", etat_civil), ("justice", justice), ("nationalite", nationalite), ("identite", identite)]:
    ecrire(f"registre-{nom}", app, SIGNATURE, ("catalogue", "documents", "predicat", "lien", "verifier"))
ecrire("passerelle", couche("Passerelle d'échange", "Branchement des registres et échanges signés avec eux.", passerelle), SESSION)
ecrire("consentement", couche("Consentement et minimisation", "Accords par dossier, préférence du citoyen, contrôle avant échange.", consentement), SESSION)
ecrire("journal", couche("Journal de traçabilité", "Journal unique, chaîné, en ajout seul, tenu par le serveur.", journal), SESSION)
ecrire("espace-usager", couche("API de l'espace usager", "Connexion par code à usage unique et état filtré par rôle.", session, etat), SESSION)
ecrire("assistant", couche("Assistant (bonus)", "Questions et vérifications en langage courant ; compétences exécutées avec les droits de la personne connectée.", assistant), SESSION)
ecrire("socle-complet", main.app, SESSION)
