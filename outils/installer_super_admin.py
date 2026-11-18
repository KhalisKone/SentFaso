"""Installation d'un socle neuf : premier super admin et, au besoin, le service d'identité.

Lancer depuis backend/ :
  python3 ../outils/installer_super_admin.py <code unique du super admin>
  python3 ../outils/installer_super_admin.py <code unique> --service-identite "Ministère de la Transition digitale"

Remet l'état du socle à zéro (/socle). Les branchements des services existants sont conservés.

Pourquoi --service-identite : pour se connecter, le code unique de chacun est vérifié par le service d'identité (double API).
Sur un socle neuf, ce service n'existe pas encore et personne ne peut se connecter pour le créer. L'option le crée et affiche
son code de branchement (une seule fois) : le service d'identité se branche alors sur /frontend/connect, puis le super admin
peut se connecter. Tout le reste (services, admins, démarches) se crée ensuite depuis l'interface.
"""
import argparse
import re
import secrets
import sys
import time
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from stockage import ref  # noqa: E402


def identifiant(nom: str) -> str:
    """« Ministère de la Transition digitale » → « ministere-de-la-transition-digitale » (comme l'interface)."""
    sans_accents = unicodedata.normalize("NFD", nom).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", sans_accents.lower()).strip("-")


def main():
    parser = argparse.ArgumentParser(description="Installation d'un socle neuf.")
    parser.add_argument("code_unique", help="code unique (17 chiffres) du premier super admin")
    parser.add_argument("--service-identite", metavar="NOM", help="crée le service d'identité (double API) et affiche son code")
    a = parser.parse_args()
    if not (a.code_unique.isdigit() and len(a.code_unique) == 17):
        sys.exit("Le code unique compte 17 chiffres.")

    ref("installation").set({"roles": {"R1": {"iu": a.code_unique, "role": "super_admin", "service": None,
                                              "code": "SA-0001", "statut": "actif", "par": "installation"}}})
    ref("socle").delete()
    print(f"Super admin {a.code_unique} créé ; état du socle remis à zéro.")

    if a.service_identite:
        sid = identifiant(a.service_identite)
        fiche = {"nom": a.service_identite, "sigle": "", "type": "ministere", "tutelle": None, "ville": "", "double_api": True}
        secret = "sk_" + secrets.token_urlsafe(24)
        ref(f"branchements/{sid}").set({**fiche, "statut": "actif", "secret": secret, "connexion": None})
        ref(f"socle/services/{sid}").set({**fiche, "statut": "actif", "cree_par": "installation",
                                          "cree_le": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())})
        print(f"\nService d'identité créé : {a.service_identite}")
        print(f"  Identifiant : {sid}")
        print(f"  Code secret : {secret}   ← montré une seule fois : à remettre à ce service, en privé")
        print("  Il se branche sur /frontend/connect (route documents ET route de vérification), puis le super admin peut se connecter.")


if __name__ == "__main__":
    main()
