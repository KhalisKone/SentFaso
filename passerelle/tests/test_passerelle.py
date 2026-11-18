"""Tests d'interopérabilité de la passerelle : branchement, contrôle par l'accord, minimisation, règles d'accès
des registres, authentification mutuelle, panne, adaptateur, liens courts, journal."""
import stockage
from banc_essai import (ADULTE_MARIE, CONDAMNE, MINEUR, REGISTRES, SECRETS_FAUX, SUPER_ADMIN, brancher_registre, connecter,
                        creer_service, etat_civil, justice, lignes_passerelle, ouvrir_accord)

PASSEPORTS = "direction-des-passeports"


def demander(socle, entetes, iu, **params):
    return socle.get("/connect/documents", headers=entetes, params={"iu": iu, "demandeur": PASSEPORTS, "dossier": "D-0001", **params})


def test_le_branchement_lit_le_catalogue_et_les_regles_du_registre(socle):
    rep = brancher_registre(socle, "tribunal-de-ouagadougou")
    assert rep["signature"] == "valide"
    cat = rep["catalogue"]
    assert cat["source"] == "registre" and cat["types"] == ["casier_judiciaire"] and cat["predicats"] == ["casier_vierge"]
    assert cat["autorisations"]["casier_judiciaire"] == ["direction-des-passeports", "ministere-de-la-fonction-publique"]
    annuaire = socle.get("/connect/services").json()
    assert all("secret" not in fiche for fiche in annuaire.values()), "l'annuaire public ne doit exposer aucun secret"


def test_seul_le_super_admin_genere_un_code_secret(socle):
    assert socle.post("/connect/services/secret", json={"id": "x", "nom": "X"}).status_code == 401
    agent = connecter(socle, "99000000000000013")
    assert socle.post("/connect/services/secret", json={"id": "x", "nom": "X"}, headers=agent).status_code == 403


def test_pas_d_accord_pas_d_echange(socle):
    brancher_registre(socle, "mairie-de-ouagadougou")
    etat_civil.trace.clear()
    agent = connecter(socle, "99000000000000013")
    rep = demander(socle, agent, ADULTE_MARIE, types="acte_naissance")
    assert rep.status_code == 403 and "aucun accord" in rep.json()["detail"]
    assert not etat_civil.trace, "aucun registre ne doit être appelé sans accord"
    assert socle.get("/connect/documents", params={"iu": ADULTE_MARIE, "types": "acte_naissance"}).status_code == 401


def test_seules_les_pieces_de_l_accord_et_demandees_sont_transmises(socle):
    brancher_registre(socle, "mairie-de-ouagadougou")
    agent, _ = ouvrir_accord(socle, ADULTE_MARIE)
    [mairie] = demander(socle, agent, ADULTE_MARIE, services="mairie-de-ouagadougou", types="acte_naissance,acte_mariage",
                        finalite="Passeport").json()
    assert mairie["signature"] == "valide"
    assert [d["type"] for d in mairie["documents"]] == ["acte_naissance"], "l'acte de mariage n'est pas couvert par l'accord"
    assert mairie["documents"][0]["url"].startswith(f"{REGISTRES}/etat-civil/fichiers/")
    appel = etat_civil.trace[0]
    assert (appel["demandeur"], appel["dossier"], appel["finalite"]) == (PASSEPORTS, "D-0001", "Passeport")


def test_un_autre_service_ne_peut_pas_utiliser_l_accord(socle):
    brancher_registre(socle, "mairie-de-ouagadougou")
    agent, _ = ouvrir_accord(socle, ADULTE_MARIE)
    rep = demander(socle, agent, ADULTE_MARIE, types="acte_naissance", demandeur="mairie-de-ouagadougou")
    assert rep.status_code == 403 and "ce service" in rep.json()["detail"]


def test_la_regle_du_registre_empeche_meme_l_appel(socle):
    brancher_registre(socle, "tribunal-de-ouagadougou")
    stockage._RefMemoire.racine["socle"]["roles"].append(
        {"id": "R9", "iu": "99000000000000015", "role": "agent", "service": "mairie-de-ouagadougou", "code": "AG-0009", "statut": "actif"})
    agent, _ = ouvrir_accord(socle, ADULTE_MARIE, pieces=["casier_judiciaire"], service="mairie-de-ouagadougou", agent="99000000000000015")
    justice.trace.clear()
    [tribunal] = socle.get("/connect/documents", headers=agent, params={"iu": ADULTE_MARIE, "services": "tribunal-de-ouagadougou", "dossier": "D-0001",
                                                                        "types": "casier_judiciaire", "demandeur": "mairie-de-ouagadougou"}).json()
    assert tribunal["refus"] and tribunal["documents"] == []
    assert not justice.trace, "le NIN ne doit pas être envoyé à un registre qui refusera"
    assert lignes_passerelle(socle, ADULTE_MARIE)[-1]["resultat"] == "refusé"


def test_reponses_minimales_sans_la_donnee_source(socle):
    brancher_registre(socle, "mairie-de-ouagadougou")
    brancher_registre(socle, "tribunal-de-ouagadougou")
    agent, _ = ouvrir_accord(socle, ADULTE_MARIE)
    ouvrir_accord(socle, MINEUR, dossier="D-0002")
    ouvrir_accord(socle, CONDAMNE, dossier="D-0003")
    reponse = lambda iu, q, d: socle.get("/connect/predicat", headers=agent, params={"iu": iu, "q": q, "demandeur": PASSEPORTS, "dossier": d}).json()[0]
    adulte, mineur = reponse(ADULTE_MARIE, "majeur", "D-0001"), reponse(MINEUR, "majeur", "D-0002")
    assert (adulte["reponse"], mineur["reponse"]) == (True, False)
    assert set(adulte) == {"service", "nom", "reponse", "erreur", "refus", "signature"}, "aucune date de naissance ne doit circuler"
    assert (reponse(ADULTE_MARIE, "casier_vierge", "D-0001")["reponse"], reponse(CONDAMNE, "casier_vierge", "D-0003")["reponse"]) == (True, False)


def test_lien_court_puis_fichier_pdf_ouvert_chez_le_registre(socle, registres):
    brancher_registre(socle, "mairie-de-ouagadougou")
    agent, _ = ouvrir_accord(socle, ADULTE_MARIE)
    [mairie] = demander(socle, agent, ADULTE_MARIE, services="mairie-de-ouagadougou", types="acte_naissance").json()
    doc = mairie["documents"][0]
    lien = socle.get("/connect/lien", headers=agent, params={"service": "mairie-de-ouagadougou", "document": doc["id"], "type": "acte_naissance",
                                                             "iu": ADULTE_MARIE, "demandeur": PASSEPORTS, "dossier": "D-0001"}).json()
    chemin = lien["url"].removeprefix("http://registres.test")
    fichier = registres.get(chemin)
    assert fichier.status_code == 200 and fichier.content.startswith(b"%PDF")
    assert registres.get(chemin.replace("sig=", "sig=0")).status_code == 403
    assert lignes_passerelle(socle, ADULTE_MARIE)[-1]["action"] == "Lien de consultation délivré"


def test_un_registre_en_panne_est_indisponible_sans_bloquer_les_autres(socle):
    brancher_registre(socle, "mairie-de-ouagadougou")
    brancher_registre(socle, "registre-de-la-nationalite")
    agent, _ = ouvrir_accord(socle, ADULTE_MARIE)
    etat_civil.panne = True
    rep = {r["service"]: r for r in demander(socle, agent, ADULTE_MARIE, types="acte_naissance,certificat_nationalite").json()}
    assert rep["mairie-de-ouagadougou"]["erreur"]
    assert rep["registre-de-la-nationalite"]["documents"], "les autres registres répondent normalement"


def test_reponse_signee_avec_une_mauvaise_cle_rejetee(socle):
    secret = creer_service(socle, "usurpateur", "Registre usurpé")
    SECRETS_FAUX["usurpateur"] = secret
    rep = socle.post("/connect/tester", json={"service_id": "usurpateur", "secret": secret, "quoi": "documents",
                                              "url": "http://usurpateur.test/documents"})
    assert rep.status_code == 400 and "signature de la réponse invalide" in rep.json()["detail"]


def test_registre_d_une_autre_equipe_branche_grace_a_l_adaptateur(socle):
    secret = creer_service(socle, "registre-externe", "Registre d'une autre équipe")
    adaptateur = {"parametre_iu": "nin", "liste": "data.items",
                  "champs": {"id": "ref", "type": "categorie", "titre": "libelle", "url": "lien"},
                  "types": {"NAISSANCE": "acte_naissance"}}
    sans = socle.post("/connect/tester", json={"service_id": "registre-externe", "secret": secret, "quoi": "documents",
                                               "url": "http://externe.test/api/pieces"})
    assert sans.status_code == 400
    rep = socle.post("/connect/brancher", json={"service_id": "registre-externe", "secret": secret, "url_documents": "http://externe.test/api/pieces",
                                                "adaptateur": adaptateur, "catalogue_declare": {"types": ["acte_naissance"]}})
    assert rep.status_code == 200 and rep.json()["signature"] == "absente"
    agent, _ = ouvrir_accord(socle, ADULTE_MARIE)
    [ext] = demander(socle, agent, ADULTE_MARIE, services="registre-externe", types="acte_naissance").json()
    assert ext["documents"] == [{"id": "EXT-1", "type": "acte_naissance", "titre": "Extrait de naissance", "url": "https://ext.test/f/1"}]


def test_verification_d_identite_minimisee_et_reservee(socle):
    agent = connecter(socle, "99000000000000013")
    assert socle.get("/connect/verifier", headers=agent, params={"iu": SUPER_ADMIN}).json() == {"valide": True, "nom": "KABORE", "prenoms": "Aminata"}
    assert socle.get("/connect/verifier", headers=agent, params={"iu": "99000000000000004"}).json() == {"valide": False}, "compte obsolète"
    citoyen = connecter(socle, ADULTE_MARIE)
    assert socle.get("/connect/verifier", headers=citoyen, params={"iu": SUPER_ADMIN}).status_code == 403


def test_chaque_echange_est_journalise_par_le_serveur(socle):
    brancher_registre(socle, "registre-de-la-nationalite")
    agent, _ = ouvrir_accord(socle, ADULTE_MARIE, dossier="D-0042")
    demander(socle, agent, ADULTE_MARIE, services="registre-de-la-nationalite", types="certificat_nationalite", dossier="D-0042")
    [ligne] = [l for l in lignes_passerelle(socle, ADULTE_MARIE) if l["action"] == "Échange avec un registre"]
    assert ligne["service"] == PASSEPORTS and "D-0042" in ligne["details"] and "réponse signée et vérifiée" in ligne["details"]
    assert socle.get("/journal/verifier").json()["ok"]
