"""Registre d'identité simulé : vérifie un identifiant unique (compte actif, obsolète ou bloqué).
Sert aux tests autonomes ; en production, le registre d'identité est celui du Ministère de la Transition digitale."""
from pathlib import Path

from commun.registre import Registre

registre = Registre(
    nom="Registre d'identité simulé",
    autorite="Registre national d'identité (simulé)",
    prefixe="IDENTITE",
    service="registre-identite-simule",
    dossier=Path(__file__).resolve().parent,
    predicats={},
    autorisations={"*": ["*"]},
    description="Vérification des identifiants uniques (NIN) : valide si le compte est actif. Nom et prénoms seulement.",
    verification=True,
)
app = registre.app
