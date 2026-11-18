"""Journal de traçabilité : ajout seul, chaînage, détection des modifications et des suppressions,
auteur fixé par la session, lecture limitée à ce qui concerne chacun."""
import stockage
from banc_essai import ADULTE_MARIE, AGENT_PASSEPORTS, SUPER_ADMIN, connecter


def ajouter(socle, entetes, n=3):
    for i in range(n):
        rep = socle.post("/journal", headers=entetes, json={"action": f"Action {i}", "iu": ADULTE_MARIE})
        assert rep.status_code == 200, rep.text


def numeros(socle):
    return [l["id"] for l in socle.get("/journal", headers=connecter(socle, SUPER_ADMIN)).json()]


def test_le_serveur_numerote_horodate_et_chaine(socle):
    ajouter(socle, connecter(socle, ADULTE_MARIE))
    lignes = socle.get("/journal", headers=connecter(socle, SUPER_ADMIN)).json()
    assert [l["id"] for l in lignes] == list(range(1, len(lignes) + 1))
    assert all(l["prev"] == p["hash"] for p, l in zip(lignes, lignes[1:]))
    assert socle.get("/journal/verifier").json() == {"ok": True, "total": len(lignes)}


def test_l_auteur_est_celui_de_la_session(socle):
    citoyen = connecter(socle, ADULTE_MARIE)
    ligne = socle.post("/journal", headers=citoyen, json={"action": "Test", "auteur": SUPER_ADMIN, "iu": ADULTE_MARIE}).json()
    assert ligne["auteur"] == ADULTE_MARIE, "l'auteur ne peut pas être usurpé"
    assert socle.post("/journal", headers=citoyen, json={"action": "Test", "casquette": "agent"}).status_code == 403
    agent = socle.post("/journal", headers=connecter(socle, AGENT_PASSEPORTS), json={"action": "Test", "casquette": "agent", "code": "AG-9999"}).json()
    assert agent["code"] == "AG-0001", "le code agent vient du rôle réel"


def test_une_ligne_modifiee_est_detectee(socle):
    ajouter(socle, connecter(socle, ADULTE_MARIE))
    cible = numeros(socle)[-2]
    stockage._RefMemoire.racine["journal"][f"L{cible:07d}"]["action"] = "Action effacée"
    assert socle.get("/journal/verifier").json()["ligne"] == cible


def test_une_ligne_supprimee_est_detectee(socle):
    ajouter(socle, connecter(socle, ADULTE_MARIE))
    del stockage._RefMemoire.racine["journal"][f"L{numeros(socle)[-1]:07d}"]
    r = socle.get("/journal/verifier").json()
    assert not r["ok"] and "supprimées" in r["raison"]


def test_chacun_ne_lit_que_ce_qui_le_concerne(socle):
    ajouter(socle, connecter(socle, ADULTE_MARIE), 1)
    autre = socle.get("/journal", headers=connecter(socle, "99000000000000020")).json()
    assert all(l.get("iu") == "99000000000000020" or l.get("auteur") == "99000000000000020" for l in autre)
    assert any(l.get("iu") == ADULTE_MARIE for l in socle.get("/journal", headers=connecter(socle, ADULTE_MARIE)).json())
    assert socle.get("/journal").status_code == 401


def test_un_navigateur_ne_peut_pas_ecrire_au_nom_de_la_passerelle(socle):
    rep = socle.post("/journal", headers=connecter(socle, ADULTE_MARIE), json={"action": "Faux échange", "casquette": "passerelle"})
    assert rep.status_code == 403


def test_l_etat_ne_peut_pas_reecrire_le_journal(socle):
    ajouter(socle, connecter(socle, ADULTE_MARIE), 1)
    avant = socle.get("/journal", headers=connecter(socle, SUPER_ADMIN)).json()
    socle.put("/etat", headers=connecter(socle, SUPER_ADMIN), json={"journal": [{"id": 1, "action": "réécrite"}]})
    assert socle.get("/journal", headers=connecter(socle, SUPER_ADMIN)).json()[: len(avant)] == avant


def test_falsification_de_demonstration_reservee_au_super_admin(socle):
    ajouter(socle, connecter(socle, ADULTE_MARIE), 2)
    assert socle.post("/journal/demo/falsifier", headers=connecter(socle, ADULTE_MARIE)).status_code == 404
    assert socle.post("/journal/demo/falsifier", headers=connecter(socle, SUPER_ADMIN)).status_code == 200
    assert not socle.get("/journal/verifier").json()["ok"]
