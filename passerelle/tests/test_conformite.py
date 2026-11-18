"""Banc de conformité et santé des registres : la preuve qu'un registre tiers respecte (ou non) le contrat."""
from banc_essai import *  # noqa: F401,F403


def passer(socle, sid, secret, base, **extra):
    return socle.post("/connect/conformite", json={"service_id": sid, "secret": secret, "url_documents": f"{base}/documents", **extra}).json()


def test_un_registre_qui_respecte_le_contrat_est_conforme(socle):
    brancher_registre(socle, "tribunal-de-ouagadougou")
    base = f"{REGISTRES}/justice"
    res = passer(socle, "tribunal-de-ouagadougou", justice.secret, base, url_catalogue=f"{base}/catalogue", url_predicat=f"{base}/predicat")
    criteres = {c["id"]: c["ok"] for c in res["criteres"]}
    assert res["conforme"] and res["obligatoires_ok"] == res["obligatoires"], res
    assert criteres["signature"] and criteres["refus-non-signe"] and criteres["refus-mal-signe"]
    assert criteres["refus-autre-service"] and criteres["refus-perime"], "rejeu et usurpation de service refusés"
    assert criteres["regles"], "le casier complet est refusé à un service non autorisé"
    assert criteres["minimisation"] and criteres["vocabulaire"]


def test_un_registre_laxiste_est_signale_non_conforme(socle):
    secret = creer_service(socle, "registre-externe", "Registre d'une autre équipe")
    adaptateur = {"parametre_iu": "nin", "liste": "data.items", "champs": {"id": "ref", "type": "categorie", "titre": "libelle", "url": "lien"}}
    res = socle.post("/connect/conformite", json={"service_id": "registre-externe", "secret": secret,
                                                  "url_documents": "http://externe.test/api/pieces", "adaptateur": adaptateur}).json()
    criteres = {c["id"]: c for c in res["criteres"]}
    assert not res["conforme"]
    assert criteres["documents"]["ok"] and criteres["test-vide"]["ok"], "il répond au bon format grâce à l'adaptateur"
    assert criteres["signature"]["ok"] is False and "non signée" in criteres["signature"]["detail"]
    assert criteres["refus-non-signe"]["ok"] is False, "il accepte un appel non signé : n'importe qui peut l'interroger"


def test_le_banc_exige_le_code_du_service(socle):
    creer_service(socle, "registre-externe", "Registre d'une autre équipe")
    rep = socle.post("/connect/conformite", json={"service_id": "registre-externe", "secret": "faux", "url_documents": "http://externe.test/api/pieces"})
    assert rep.status_code == 401


def test_sante_et_banc_des_registres_branches_reserves_au_super_admin(socle):
    brancher_registre(socle, "registre-de-la-nationalite")
    sa = connecter(socle, SUPER_ADMIN)
    sante = {r["service"]: r for r in socle.get("/connect/sante", headers=sa).json()}
    assert sante["registre-de-la-nationalite"]["repond"] and sante["registre-de-la-nationalite"]["signature"] == "vérifiée"
    assert socle.post("/connect/conformite/registre-de-la-nationalite", headers=sa).json()["conforme"]
    agent = connecter(socle, AGENT_PASSEPORTS)
    assert socle.get("/connect/sante", headers=agent).status_code == 403
    assert socle.post("/connect/conformite/registre-de-la-nationalite", headers=agent).status_code == 403
    journal = socle.get("/journal", headers=sa).json()
    assert any(l["action"] == "Banc de conformité" for l in journal), "chaque passage au banc est journalisé"


def test_modifier_la_fiche_d_un_service_garde_son_branchement(socle):
    brancher_registre(socle, "registre-de-la-nationalite")
    sa = connecter(socle, SUPER_ADMIN)
    rep = socle.put("/connect/services/registre-de-la-nationalite/fiche", headers=sa,
                    json={"nom": "Direction de la nationalité", "sigle": "DN", "type": "direction", "ville": "Ouagadougou"})
    assert rep.status_code == 200
    fiche = socle.get("/connect/services").json()["registre-de-la-nationalite"]
    assert fiche["nom"] == "Direction de la nationalité" and fiche["branche"], "renommé, toujours branché"
    assert socle.put("/connect/services/registre-de-la-nationalite/fiche", headers=connecter(socle, AGENT_PASSEPORTS),
                     json={"nom": "x"}).status_code == 403
