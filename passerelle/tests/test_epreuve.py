"""Épreuve en direct avec un registre au format inconnu (comme ceux du jury) : il ne donne que des fiches (date de naissance,
mentions du casier), sans réponse oui/non ni signature. Le socle calcule « majeur : oui » sans transmettre la date,
et les citoyens de ce registre peuvent se connecter pour voir qui a consulté leurs données."""
import json

from banc_essai import *  # noqa: F401,F403

ADULTE_JURY, MINEUR_JURY, INCONNU_JURY = "12345678901234567", "12345678901234568", "12345678901234569"
PASSEPORTS = "direction-des-passeports"


def brancher_jury(socle, double_api=False):
    secret = creer_service(socle, "etat-civil-jury", "État civil (jury)", double_api=double_api)
    adaptateur = {"parametre_iu": "nin", "liste": "items", "champs": {"id": "ref", "type": "nature", "titre": "libelle", "url": "lien"},
                  "types": {"NAISSANCE": "acte_naissance"},
                  "calculs": {"majeur": {"url": "http://jury.test/personnes/{iu}", "champ": "data.date_naissance"},
                              "casier_vierge": {"url": "http://jury.test/casier", "champ": "mentions"}},
                  "verifier_presence": True, "verifier": {"nom": "data.nom", "prenoms": "data.prenom"}}
    corps = {"service_id": "etat-civil-jury", "secret": secret, "url_documents": "http://jury.test/documents", "adaptateur": adaptateur,
             "catalogue_declare": {"types": ["acte_naissance"]}}
    if double_api:
        corps["url_verifier"] = "http://jury.test/personnes/{iu}"
    rep = socle.post("/connect/brancher", json=corps)
    assert rep.status_code == 200, rep.text
    return secret


def demander(socle, iu, q):
    agent, _ = ouvrir_accord(socle, iu, dossier=f"D-{iu[-3:]}-{q}", pieces=(q,))
    return socle.get("/connect/predicat", headers=agent, params={"iu": iu, "q": q, "demandeur": PASSEPORTS, "dossier": f"D-{iu[-3:]}-{q}"}).json()


def test_majeur_calcule_par_le_socle_sans_transmettre_la_date(socle):
    brancher_jury(socle)
    assert "majeur" in socle.get("/connect/services").json()["etat-civil-jury"]["predicats"], "annoncé dans l'annuaire"
    [rep] = demander(socle, ADULTE_JURY, "majeur")
    assert rep["reponse"] is True and "1990" not in json.dumps(rep)
    journal = socle.get("/journal", headers=connecter(socle, SUPER_ADMIN)).json()
    ligne = next(l for l in journal if l.get("iu") == ADULTE_JURY and l["action"] == "Réponse minimale demandée")
    assert "calculée par le socle" in ligne["details"] and "1990" not in json.dumps(journal), "la date n'est ni transmise ni journalisée"


def test_mineur_et_personne_inconnue(socle):
    brancher_jury(socle)
    assert demander(socle, MINEUR_JURY, "majeur")[0]["reponse"] is False
    assert demander(socle, INCONNU_JURY, "majeur")[0]["reponse"] is None, "inconnue du registre : « inconnu », pas une erreur"


def test_casier_vierge_calcule_sans_transmettre_les_mentions(socle):
    brancher_jury(socle)
    assert demander(socle, ADULTE_JURY, "casier_vierge")[0]["reponse"] is True
    rep = demander(socle, MINEUR_JURY, "casier_vierge")
    assert rep[0]["reponse"] is False and "vol" not in json.dumps(rep)


def test_tester_un_calcul_depuis_la_page_de_branchement(socle):
    secret = brancher_jury(socle)
    rep = socle.post("/connect/tester", json={"service_id": "etat-civil-jury", "secret": secret, "quoi": "calcul", "q": "majeur",
                                              "url": "http://jury.test/personnes/{iu}", "iu_essai": ADULTE_JURY,
                                              "adaptateur": {"calculs": {"majeur": {"champ": "data.date_naissance"}}}})
    assert rep.status_code == 200 and rep.json()["reponse"] == {"q": "majeur", "reponse": "oui"} and "1990" not in rep.text


def test_les_citoyens_du_registre_du_jury_se_connectent(socle):
    """Deux sources d'identité : notre registre d'identité simulé et l'état civil du jury ; il suffit que l'une reconnaisse."""
    brancher_jury(socle, double_api=True)
    code = socle.post("/session/code", json={"iu": ADULTE_JURY}).json()["code_demo"]
    assert code, "reconnu par l'état civil du jury"
    jeton = socle.post("/session/ouvrir", json={"iu": ADULTE_JURY, "code": code}).json()["jeton"]
    moi = socle.get("/session", headers={"Authorization": f"Bearer {jeton}"}).json()
    assert (moi["nom"], moi["prenoms"]) == ("SANOU", "Awa")
    assert socle.post("/session/code", json={"iu": SUPER_ADMIN}).json()["code_demo"], "les citoyens de l'autre source aussi"
    assert socle.post("/session/code", json={"iu": INCONNU_JURY}).json()["code_demo"] is None, "inconnu partout : pas de code"
