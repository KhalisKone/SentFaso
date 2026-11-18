"""Gestion des services par le super admin : suppression, avec ses garde-fous."""
from banc_essai import *  # noqa: F401,F403


def test_supprimer_un_service_annule_son_code_et_ne_revient_pas(socle):
    brancher_registre(socle, "registre-de-la-nationalite")
    sa = connecter(socle, SUPER_ADMIN)
    assert socle.delete("/connect/services/registre-de-la-nationalite", headers=connecter(socle, AGENT_PASSEPORTS)).status_code == 403
    rep = socle.delete("/connect/services/registre-de-la-nationalite", headers=sa)
    assert rep.status_code == 200, rep.text
    assert "registre-de-la-nationalite" not in socle.get("/connect/services").json(), "code annulé, plus dans l'annuaire"
    assert "registre-de-la-nationalite" not in socle.get("/etat", headers=sa).json()["services"]
    assert any(l["action"] == "Service supprimé" for l in socle.get("/journal", headers=sa).json())
    # Un écran resté ouvert renvoie l'ancien état : le service n'est pas recréé.
    socle.put("/etat", headers=sa, json={"services": {"registre-de-la-nationalite": {"nom": "Registre de la nationalité", "statut": "actif"}}})
    assert "registre-de-la-nationalite" not in socle.get("/etat", headers=sa).json()["services"]
    # Recréé volontairement (nouveau code) : il redevient normal.
    creer_service(socle, "registre-de-la-nationalite", "Registre de la nationalité")
    socle.put("/etat", headers=sa, json={"services": {"registre-de-la-nationalite": {"nom": "Registre de la nationalité", "statut": "actif"}}})
    assert "registre-de-la-nationalite" in socle.get("/etat", headers=sa).json()["services"]


def test_suppression_revoque_les_roles_et_retire_les_demarches(socle):
    sa = connecter(socle, SUPER_ADMIN)
    creer_service(socle, "direction-des-passeports", "Direction des passeports")
    rep = socle.delete("/connect/services/direction-des-passeports", headers=sa).json()
    assert rep["roles"] == 2 and rep["demarches"] == 1, rep
    roles = [r for r in socle.get("/etat", headers=sa).json()["roles"] if r.get("service") == "direction-des-passeports"]
    assert roles and all(r["statut"] == "revoque" for r in roles)


def test_suppression_refusee_tant_que_des_dossiers_sont_ouverts(socle):
    agent = connecter(socle, AGENT_PASSEPORTS)
    socle.put("/etat", headers=agent, json={"dossiers": {"D-0001": {"service": "direction-des-passeports", "iu": ADULTE_MARIE, "statut": "autorise"}}})
    rep = socle.delete("/connect/services/direction-des-passeports", headers=connecter(socle, SUPER_ADMIN))
    assert rep.status_code == 409 and "clôturés" in rep.json()["detail"]


def test_suppression_du_seul_service_d_identite_refusee(socle):
    rep = socle.delete("/connect/services/registre-identite-simule", headers=connecter(socle, SUPER_ADMIN))
    assert rep.status_code == 409 and "plus personne ne pourrait se connecter" in rep.json()["detail"]
