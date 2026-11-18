"""Couche journal de traçabilité : unique, chaîné par SHA-256, en ajout seul, tenu par le serveur."""
from journal.api import ajouter, lignes, migrer_journal_navigateur, router, verifier  # noqa: F401
