"""Couche consentement et minimisation : accord créé à l'ouverture, contrôle avant échange, clôture par l'agent."""
import pytest

from banc_essai import ADULTE_MARIE, AGENT_PASSEPORTS, SUPER_ADMIN, brancher_registre, connecter, etat_civil, ouvrir_accord
from consentement import regles

PASSEPORTS = "direction-des-passeports"


def test_par_defaut_l_accord_est_actif_des_l_ouverture(socle):
    _, accord = ouvrir_accord(socle, ADULTE_MARIE)
    assert accord["statut"] == "actif" and accord["requis"] is False and accord["base_legale"]


def test_le_citoyen_n_a_aucune_demarche_a_faire(socle):
    """Plus de paramètre « Demander mon accord » ni de boutons accepter, refuser, retirer : ces routes n'existent plus."""
    ouvrir_accord(socle, ADULTE_MARIE)
    citoyen = connecter(socle, ADULTE_MARIE)
    for action in ("accepter", "refuser", "retirer"):
        assert socle.post(f"/consentement/accords/D-0001/{action}", headers=citoyen).status_code in (404, 405)
    assert socle.put(f"/consentement/preferences/{ADULTE_MARIE}", headers=citoyen, json={"demander_accord": True}).status_code in (404, 405)


def test_la_cloture_par_l_agent_met_fin_a_l_accord_et_coupe_l_acces(socle):
    brancher_registre(socle, "mairie-de-ouagadougou")
    agent, _ = ouvrir_accord(socle, ADULTE_MARIE)
    assert socle.post("/consentement/accords/D-0001/clore", headers=connecter(socle, ADULTE_MARIE)).status_code == 403
    assert socle.post("/consentement/accords/D-0001/clore", headers=agent).json()["statut"] == "clos"
    rep = socle.get("/connect/documents", headers=agent, params={"iu": ADULTE_MARIE, "types": "acte_naissance", "demandeur": PASSEPORTS, "dossier": "D-0001"})
    assert rep.status_code == 403 and "clos" in rep.json()["detail"]
    assert socle.post("/consentement/accords/D-0001/clore", headers=agent).status_code == 409


def test_seul_un_agent_du_service_ouvre_un_accord_et_jamais_pour_lui_meme(socle):
    corps = {"dossier": "D-0009", "iu": ADULTE_MARIE, "service": PASSEPORTS, "finalite": "x", "base_legale": "y", "pieces": ["acte_naissance"]}
    assert socle.post("/consentement/accords", headers=connecter(socle, SUPER_ADMIN), json=corps).status_code == 403
    soi = {**corps, "iu": AGENT_PASSEPORTS}
    assert socle.post("/consentement/accords", headers=connecter(socle, AGENT_PASSEPORTS), json=soi).status_code == 403
    sans_finalite = {**corps, "finalite": " "}
    assert socle.post("/consentement/accords", headers=connecter(socle, AGENT_PASSEPORTS), json=sans_finalite).status_code == 400
    sans_base = {k: v for k, v in corps.items() if k != "base_legale"}  # base légale facultative
    assert socle.post("/consentement/accords", headers=connecter(socle, AGENT_PASSEPORTS), json=sans_base).status_code == 200


def test_controle_expose(socle):
    agent, _ = ouvrir_accord(socle, ADULTE_MARIE, pieces=["acte_naissance", "majeur"])
    ok = socle.get("/consentement/controle", headers=agent, params={"dossier": "D-0001", "iu": ADULTE_MARIE, "demandeur": PASSEPORTS,
                                                                    "codes": "acte_naissance,acte_mariage"}).json()
    assert ok == {"autorise": True, "codes_autorises": ["acte_naissance"]}, "minimisation : l'acte de mariage n'est pas couvert"


# ── Règles pures ─────────────────────────────────────────────────────────────
def accord(**champs):
    a = regles.nouvel_accord(dossier="D", iu="1", service="s", agent="AG", finalite="f", base_legale="b", pieces=["a", "b"], duree=30, requis=False)
    return {**a, **champs}


def test_regles_controle():
    assert regles.controler(accord(), iu="1", demandeur="s", codes=["a", "z"]) == ["a"]
    for motif, a, kw in [("aucun accord", None, {}), ("cette personne", accord(), {"iu": "2"}), ("ce service", accord(), {"demandeur": "t"}),
                         ("expiré", accord(expire="2000-01-01T00:00:00Z"), {}), ("non couverte", accord(), {"codes": ["z"]})]:
        with pytest.raises(PermissionError, match=motif):
            regles.controler(a, **{"iu": "1", "demandeur": "s", "codes": ["a"], **kw})


def test_regles_transitions():
    a = regles.appliquer(accord(), "clore", "AG-0001")
    assert a["statut"] == "clos" and a["historique"][-1]["action"] == "clore"
    with pytest.raises(ValueError):
        regles.appliquer(a, "clore", "AG-0001")
