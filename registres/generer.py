"""Génère les données fictives de chaque registre à partir de la population fictive (donnees/personnes.json).

Chaque registre reçoit SES données (il ne voit pas celles des autres). Les règles sont déterministes, pour que
la démonstration couvre tous les cas : pièce trouvée, pièce absente (« à fournir »), pièce détenue par deux
registres (« à choisir »), casier non vierge, mineurs.

Lancer depuis registres/ :  python3 generer.py
"""
import json
from datetime import date
from pathlib import Path

ICI = Path(__file__).resolve().parent
PERSONNES = json.loads((ICI / "donnees" / "personnes.json").read_text(encoding="utf-8"))


def numero(p):  # rang de la personne : 99000000000000042 → 42
    return int(p["nin"][-3:])


def age(p, ref=date(2026, 11, 18)):
    n = date.fromisoformat(p["date_naissance"])
    return ref.year - n.year - ((ref.month, ref.day) < (n.month, n.day))


def fr(iso):
    a, m, j = iso.split("-")
    return f"{j}/{m}/{a}"


def identite(p):
    return [["Nom", p["nom"]], ["Prénoms", p["prenoms"]], ["Né(e) le", fr(p["date_naissance"])], ["NIN", p["nin"]]]


def ecrire(dossier, personnes, documents):
    (ICI / dossier / "donnees.json").write_text(
        json.dumps({"personnes": personnes, "documents": documents}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{dossier:<12} {len(personnes):>3} personnes, {sum(len(d) for d in documents.values()):>3} documents")


# ── État civil (Mairie) : actes de naissance (sauf 1 personne sur 25), actes de mariage (1 adulte sur 3) ──
ec_personnes, ec_docs = {}, {}
for p in PERSONNES:
    n = numero(p)
    if n % 25 == 0:
        continue  # né(e) hors de cette commune : aucun acte ici
    ec_personnes[p["nin"]] = {"nom": p["nom"], "prenoms": p["prenoms"], "date_naissance": p["date_naissance"]}
    docs = [{"id": f"AN-{p['date_naissance'][:4]}-{n:05d}", "type": "acte_naissance", "titre": "Acte de naissance",
             "date": p["date_naissance"], "champs": identite(p) + [["Lieu de naissance", "Ouagadougou"]]}]
    if age(p) >= 21 and n % 3 == 0:
        docs.append({"id": f"AM-2019-{n:05d}", "type": "acte_mariage", "titre": "Acte de mariage", "date": "2019-12-14",
                     "champs": identite(p) + [["Date du mariage", "14/12/2019"], ["Lieu", "Mairie de Ouagadougou"]]})
    ec_docs[p["nin"]] = docs
ecrire("etat_civil", ec_personnes, ec_docs)

# ── Justice (Tribunal) : bulletin n° 3 du casier pour les majeurs ; 1 sur 17 porte une condamnation ──
ju_personnes, ju_docs = {}, {}
for p in PERSONNES:
    n = numero(p)
    if age(p) < 18:
        continue
    condamne = n % 17 == 0
    ju_personnes[p["nin"]] = {"nom": p["nom"], "prenoms": p["prenoms"], "casier_vierge": not condamne}
    ju_docs[p["nin"]] = [{"id": f"CJ3-2026-{n:05d}", "type": "casier_judiciaire", "titre": "Extrait de casier judiciaire (bulletin n° 3)",
                          "date": "2026-11-01", "champs": identite(p) + [["Mentions", "Condamnation (2021)" if condamne else "Néant"]]}]
ecrire("justice", ju_personnes, ju_docs)

# ── Nationalité : certificat (sauf 1 personne sur 20) ; copie de l'acte de naissance au dossier pour 1 sur 10 ──
na_personnes, na_docs = {}, {}
for p in PERSONNES:
    n = numero(p)
    if n % 20 == 0:
        continue
    na_personnes[p["nin"]] = {"nom": p["nom"], "prenoms": p["prenoms"]}
    docs = [{"id": f"CN-2024-{n:05d}", "type": "certificat_nationalite", "titre": "Certificat de nationalité burkinabè",
             "date": "2024-03-05", "champs": identite(p) + [["Nationalité", "Burkinabè (par filiation)"]]}]
    if n % 10 == 0:
        docs.append({"id": f"CAN-2024-{n:05d}", "type": "acte_naissance", "titre": "Acte de naissance (copie au dossier de nationalité)",
                     "date": p["date_naissance"], "champs": identite(p) + [["Copie certifiée", "05/03/2024"]]})
    na_docs[p["nin"]] = docs
ecrire("nationalite", na_personnes, na_docs)

# ── Identité (registre simulé, pour les tests autonomes ; en production : le registre du ministère) ──
ecrire("identite", {p["nin"]: {"nom": p["nom"], "prenoms": p["prenoms"], "compte": p["compte"]} for p in PERSONNES}, {})
