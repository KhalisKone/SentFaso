"""Héberge les registres simulés sur un même serveur, chacun sous son propre chemin.
Chaque registre reste une application indépendante (données, code secret, règles d'accès, console) :
on pourrait aussi lancer chacun seul, ex. `uvicorn etat_civil.app:app`.

Lancer depuis registres/ :  uvicorn serveur:app --port 8005 --proxy-headers
"""
from fastapi import FastAPI

from etat_civil.app import app as etat_civil
from identite.app import app as identite
from justice.app import app as justice
from nationalite.app import app as nationalite

PREFIXE = "/registres"
REGISTRES = {"etat-civil": etat_civil, "justice": justice, "nationalite": nationalite, "identite": identite}

app = FastAPI(title="Registres simulés — Dites-le-nous une fois", docs_url=None, redoc_url=None, openapi_url=None)
for chemin, registre in REGISTRES.items():
    app.mount(f"{PREFIXE}/{chemin}", registre)


@app.get(PREFIXE)
def liste():
    return {chemin: f"{PREFIXE}/{chemin}" for chemin in REGISTRES}
