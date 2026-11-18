"""Serveur du socle : assemble les couches (passerelle, consentement et minimisation, journal) et sert l'espace usager.
Lancer depuis backend/ :  uvicorn main:app --port 8100

Organisation du dépôt, un dossier par couche :
  registres/       registres simulés (état civil, justice, nationalité, identité)
  passerelle/      passerelle d'échange (/connect)
  consentement/    consentement et minimisation (/consentement)
  journal/         journal de traçabilité (/journal)
  assistant/       assistant conversationnel (bonus, /assistant)
  espace-usager/   interface (espace citoyen, guichet agent, administration)
  backend/         ce serveur : session, contrôle d'accès, état du socle, stockage
"""
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RACINE))  # les couches sont des dossiers à la racine du dépôt

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException

from assistant import router as assistant  # noqa: E402
from consentement import migrer_accords_existants, router as consentement  # noqa: E402
from etat import router as etat  # noqa: E402
from journal import migrer_journal_navigateur, router as journal  # noqa: E402
from passerelle.api import router as passerelle  # noqa: E402
from session import router as session  # noqa: E402

# Espace usager construit (espace-usager/dist) ; à défaut, l'emplacement précédent (web/dist).
INTERFACE = next((d for d in (RACINE / "espace-usager" / "dist", RACINE / "web" / "dist") if (d / "index.html").exists()),
                 RACINE / "espace-usager" / "dist")


class Application(StaticFiles):
    """Fichiers statiques d'une application à une page : toute route inconnue sans extension renvoie index.html."""

    async def get_response(self, path, scope):
        try:
            reponse = await super().get_response(path, scope)
        except HTTPException as e:
            if e.status_code == 404 and "." not in path.rsplit("/", 1)[-1]:
                reponse = await super().get_response("index.html", scope)
            else:
                raise
        # Les fichiers de assets/ portent une empreinte dans leur nom : gardés en cache. La page, elle, est revérifiée à
        # chaque visite, pour qu'une nouvelle version s'affiche tout de suite.
        reponse.headers["Cache-Control"] = ("public, max-age=31536000, immutable" if path.startswith("assets/")
                                            else "no-cache")
        return reponse


app = FastAPI(
    title="Socle « Dites-le-nous une fois »",
    version="2.0",
    description=(
        "Socle d'interopérabilité entre administrations. Les pièces restent chez les registres ; la passerelle les "
        "interroge pour un dossier, avec authentification mutuelle (HMAC-SHA256 dans les deux sens), minimisation "
        "(types demandés, réponses oui/non), règles d'accès décidées par chaque registre, et journal chaîné tenu par le serveur."
    ),
    openapi_tags=[
        {"name": "session", "description": "Connexion par identifiant unique et code à usage unique ; jeton de session."},
        {"name": "passerelle", "description": "Branchement des registres et échanges avec eux (/connect)."},
        {"name": "consentement", "description": "Accords par dossier, préférences du citoyen, contrôle avant échange."},
        {"name": "journal", "description": "Journal de traçabilité : ajout seul, chaîné par SHA-256, scellé."},
        {"name": "etat", "description": "État du socle filtré par rôle : services, rôles, démarches, dossiers."},
        {"name": "assistant", "description": "Assistant (Claude Haiku) : conversations, compétences exécutées avec les droits de la personne."},
    ],
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST", "PUT"], allow_headers=["*"])

for routeur in (session, passerelle, consentement, journal, etat, assistant):
    app.include_router(routeur)

# Reprises uniques (sans effet ensuite) : ancien journal écrit par le navigateur, accords des anciens dossiers.
migrer_journal_navigateur()
migrer_accords_existants()

app.mount("/frontend", Application(directory=INTERFACE, html=True), name="frontend")


@app.get("/")
def accueil():
    return RedirectResponse("/frontend/")
