"""Registre de l'état civil (Mairie de Ouagadougou) : actes de naissance et de mariage, réponse « majeur : oui/non »."""
from pathlib import Path

from commun.registre import Registre, age

registre = Registre(
    nom="Registre de l'état civil — Mairie de Ouagadougou",
    autorite="Mairie de Ouagadougou — Service de l'état civil",
    prefixe="ETAT_CIVIL",
    service="mairie-de-ouagadougou",
    dossier=Path(__file__).resolve().parent,
    predicats={"majeur": lambda p: age(p) >= 18},
    autorisations={"*": ["*"]},  # l'état civil répond à tous les services branchés
    description="Actes de naissance et de mariage. Répond « majeur : oui/non » sans transmettre la date de naissance.",
)
app = registre.app
