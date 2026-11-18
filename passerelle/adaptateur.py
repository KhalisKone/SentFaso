"""Adaptateur : traduit vers le contrat commun la réponse d'un registre qui parle un autre format
(registre d'une autre équipe, système existant d'une administration).

Réglages possibles (tous facultatifs, défaut = contrat commun) :
  parametre_iu   nom du paramètre qui porte l'identifiant unique (ex. « nin »)
  liste          chemin de la liste des documents dans la réponse (ex. « data.items » ; vide = la réponse elle-même)
  champs         correspondance des champs : {"id": "reference", "type": "categorie", "titre": "libelle", "url": "lien", "date": "emis_le"}
  types          correspondance des valeurs de type : {"NAISSANCE": "acte_naissance"}
  verifier       correspondance des champs de la vérification d'identité : {"valide": "existe", "nom": "nom_famille", "prenoms": "prenom"}
  verifier_presence  vrai : la personne est reconnue dès que sa fiche existe (pas de champ « valide » ; 404 = inconnue)
  calculs        réponses oui/non calculées par le socle quand le registre ne les propose pas :
                 {"majeur": {"url": "https://…/personnes/{iu}", "champ": "date_naissance"},
                  "casier_vierge": {"url": "https://…/casiers?nin=", "champ": "mentions"}}
                 Le socle lit la donnée source, calcule oui/non, et l'oublie : elle n'est ni transmise, ni conservée, ni journalisée.
Dans toute adresse, « {iu} » est remplacé par l'identifiant unique (sinon il est passé en paramètre).
"""
from datetime import date, datetime
CHAMPS = ("id", "type", "titre", "url", "date")
DEFAUT = {
    "parametre_iu": "iu",
    "liste": "",
    "champs": {c: c for c in CHAMPS},
    "types": {},
    "verifier": {"valide": "valide", "nom": "nom", "prenoms": "prenoms"},
    "verifier_presence": False,
    "calculs": {},
}
CALCULABLES = {"majeur": "date de naissance", "casier_vierge": "mentions du casier"}


class FormatInattendu(Exception):
    pass


def completer(adaptateur: dict | None) -> dict:
    a = adaptateur or {}
    return {
        "parametre_iu": (a.get("parametre_iu") or "iu").strip(),
        "liste": (a.get("liste") or "").strip(),
        "champs": {**DEFAUT["champs"], **{k: v for k, v in (a.get("champs") or {}).items() if v}},
        "types": {k: v for k, v in (a.get("types") or {}).items() if k and v},
        "verifier": {**DEFAUT["verifier"], **{k: v for k, v in (a.get("verifier") or {}).items() if v}},
        "verifier_presence": bool(a.get("verifier_presence")),
        "calculs": {q: {"url": c["url"].strip(), "champ": c["champ"].strip()} for q, c in (a.get("calculs") or {}).items()
                    if q in CALCULABLES and isinstance(c, dict) and (c.get("url") or "").strip() and (c.get("champ") or "").strip()},
    }


def est_defaut(adaptateur: dict | None) -> bool:
    return completer(adaptateur) == DEFAUT


def _suivre(donnees, chemin: str):
    for cle in [c for c in chemin.split(".") if c]:
        if not isinstance(donnees, dict) or cle not in donnees:
            raise FormatInattendu(f"chemin de liste « {chemin} » introuvable dans la réponse")
        donnees = donnees[cle]
    return donnees


def documents(reponse, adaptateur: dict | None) -> list:
    a = completer(adaptateur)
    liste = _suivre(reponse, a["liste"])
    if not isinstance(liste, list):
        raise FormatInattendu("la réponse doit contenir une liste de documents")
    sortie = []
    for brut in liste:
        if not isinstance(brut, dict):
            continue
        doc = {c: brut.get(a["champs"][c]) for c in CHAMPS}
        doc["type"] = a["types"].get(doc["type"], doc["type"])
        sortie.append({k: v for k, v in doc.items() if v is not None})
    return sortie


def _vrai(v) -> bool:
    return v is True or (isinstance(v, str) and v.strip().lower() in {"true", "oui", "1", "vrai"}) or v == 1


def valeur(donnees, chemin: str):
    """Valeur au chemin « a.b.c » (ou None si absente) ; une liste à un seul élément est traversée (fiche dans une liste)."""
    for cle in [c for c in chemin.split(".") if c]:
        if isinstance(donnees, list) and len(donnees) == 1:
            donnees = donnees[0]
        if not isinstance(donnees, dict) or cle not in donnees:
            return None
        donnees = donnees[cle]
    return donnees


def verification(reponse, adaptateur: dict | None) -> dict:
    complet = completer(adaptateur)
    a = complet["verifier"]
    if isinstance(reponse, list) and len(reponse) == 1:
        reponse = reponse[0]
    if not isinstance(reponse, dict):
        raise FormatInattendu("la vérification doit renvoyer un objet JSON")
    valide = bool(reponse) if complet["verifier_presence"] else _vrai(valeur(reponse, a["valide"]))
    return {"valide": valide, "nom": valeur(reponse, a["nom"]), "prenoms": valeur(reponse, a["prenoms"])}


def _date(v):
    if isinstance(v, (date, datetime)):
        return v if isinstance(v, date) else v.date()
    texte = str(v or "").strip()[:10]
    for forme in ("%Y-%m-%d", "%d/%m/%Y", "%Y/%m/%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(texte, forme).date()
        except ValueError:
            pass
    return None


def calculer(q: str, source, aujourdhui: date | None = None) -> bool | None:
    """Réponse oui/non à partir de la donnée source (None = impossible à dire). La donnée source n'est pas renvoyée."""
    if source is None:
        return None
    if q == "majeur":
        n, a = _date(source), aujourdhui or date.today()
        return None if n is None else (a.year - n.year - ((a.month, a.day) < (n.month, n.day))) >= 18
    if q == "casier_vierge":
        if isinstance(source, bool):
            return source
        if isinstance(source, (list, dict)):
            return len(source) == 0
        if isinstance(source, (int, float)):
            return source == 0
        return str(source).strip().lower() in {"", "neant", "néant", "aucune", "aucun", "vierge", "rien"}
    return None
