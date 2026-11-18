"""Registre judiciaire (Tribunal de grande instance de Ouagadougou) : casier judiciaire, réponse « casier vierge : oui/non »."""
from pathlib import Path

from commun.registre import Registre

registre = Registre(
    nom="Casier judiciaire — Tribunal de grande instance de Ouagadougou",
    autorite="Tribunal de grande instance de Ouagadougou — Casier judiciaire",
    prefixe="JUSTICE",
    service="tribunal-de-ouagadougou",
    dossier=Path(__file__).resolve().parent,
    predicats={"casier_vierge": lambda p: p["casier_vierge"]},
    # Le bulletin complet est réservé à des services désignés ; la réponse minimale « casier vierge » est ouverte à tous.
    autorisations={
        "casier_judiciaire": ["direction-des-passeports", "ministere-de-la-fonction-publique"],
        "casier_vierge": ["*"],
    },
    description="Extraits de casier judiciaire (bulletin n° 3), réservés aux services autorisés. "
                "Répond « casier vierge : oui/non » à tous les services, sans transmettre les mentions.",
)
app = registre.app
