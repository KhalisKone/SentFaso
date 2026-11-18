"""Registre de la nationalité : certificats de nationalité (et copies d'actes de naissance versées aux dossiers)."""
from pathlib import Path

from commun.registre import Registre

registre = Registre(
    nom="Registre de la nationalité — Ministère de la Justice",
    autorite="Ministère de la Justice — Registre de la nationalité",
    prefixe="NATIONALITE",
    service="registre-de-la-nationalite",
    dossier=Path(__file__).resolve().parent,
    predicats={},
    autorisations={"*": ["*"]},
    description="Certificats de nationalité burkinabè, et copies d'actes de naissance versées aux dossiers de nationalité.",
)
app = registre.app
