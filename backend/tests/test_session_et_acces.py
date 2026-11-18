"""Socle : connexion par code à usage unique, jetons de session, état filtré par rôle et écritures contrôlées."""
import stockage
from banc_essai import ADMIN_PASSEPORTS, ADULTE_MARIE, AGENT_PASSEPORTS, SUPER_ADMIN, connecter, ouvrir_accord


def test_connexion_par_code_a_usage_unique(socle):
    code = socle.post("/session/code", json={"iu": ADULTE_MARIE}).json()["code_demo"]
    assert socle.post("/session/ouvrir", json={"iu": ADULTE_MARIE, "code": "000000" if code != "000000" else "111111"}).status_code == 401
    jeton = socle.post("/session/ouvrir", json={"iu": ADULTE_MARIE, "code": code}).json()["jeton"]
    assert socle.get("/session", headers={"Authorization": f"Bearer {jeton}"}).json()["iu"] == ADULTE_MARIE
    assert socle.post("/session/ouvrir", json={"iu": ADULTE_MARIE, "code": code}).status_code == 401, "un code ne sert qu'une fois"


def test_reponse_neutre_pour_un_identifiant_inconnu_ou_inactif(socle):
    inconnu = socle.post("/session/code", json={"iu": "99000000000000999"}).json()
    bloque = socle.post("/session/code", json={"iu": "99000000000000007"}).json()
    assert inconnu["code_demo"] is None and bloque["code_demo"] is None
    assert inconnu["message"] == bloque["message"], "on ne révèle pas quels identifiants existent"


def test_trois_essais_au_plus(socle):
    socle.post("/session/code", json={"iu": ADULTE_MARIE})
    for _ in range(3):
        socle.post("/session/ouvrir", json={"iu": ADULTE_MARIE, "code": "pas-un-code"})
    code_bon = stockage._RefMemoire.racine["sessions"]["codes"][ADULTE_MARIE]
    assert code_bon["essais"] == 3
    assert socle.post("/session/ouvrir", json={"iu": ADULTE_MARIE, "code": "x"}).json()["detail"].startswith("Code expiré ou trop d'essais")


def test_jeton_falsifie_refuse(socle):
    entetes = connecter(socle, ADULTE_MARIE)
    faux = entetes["Authorization"][:-2] + ("00" if not entetes["Authorization"].endswith("00") else "11")
    assert socle.get("/etat", headers={"Authorization": faux}).status_code == 401
    assert socle.get("/etat").status_code == 401


def test_chacun_ne_voit_que_ce_que_son_role_permet(socle):
    ouvrir_accord(socle, ADULTE_MARIE)
    stockage._RefMemoire.racine["socle"]["dossiers"] = {"D-0001": {"id": "D-0001", "iu": ADULTE_MARIE, "service": "direction-des-passeports", "pieces": {}}}
    agent = socle.get("/etat", headers=connecter(socle, AGENT_PASSEPORTS)).json()
    assert list(agent["dossiers"]) == ["D-0001"] and agent["dossiers"]["D-0001"]["consent"]["statut"] == "actif"
    citoyen = socle.get("/etat", headers=connecter(socle, ADULTE_MARIE)).json()
    assert list(citoyen["dossiers"]) == ["D-0001"] and citoyen["demarches"] == {}
    assert socle.get("/etat", headers=connecter(socle, ADMIN_PASSEPORTS)).json()["dossiers"] == {}, "l'admin ne voit aucun dossier"
    assert socle.get("/etat", headers=connecter(socle, SUPER_ADMIN)).json()["dossiers"] == {}, "le super admin ne voit aucun dossier"
    assert socle.get("/etat", headers=connecter(socle, "99000000000000020")).json()["dossiers"] == {}


def test_les_ecritures_sont_limitees_au_role(socle):
    citoyen = connecter(socle, ADULTE_MARIE)
    rep = socle.put("/etat", headers=citoyen, json={"services": {"pirate": {"nom": "Pirate"}},
                                                    "roles": [{"id": "RX", "iu": ADULTE_MARIE, "role": "super_admin", "statut": "actif"}]}).json()
    assert "services" in rep["refus"] and "pirate" not in stockage._RefMemoire.racine["socle"]["services"]
    assert not any(r["id"] == "RX" for r in stockage._RefMemoire.racine["socle"]["roles"]), "un citoyen ne se nomme pas super admin"
    admin = connecter(socle, ADMIN_PASSEPORTS)
    socle.put("/etat", headers=admin, json={"roles": [{"id": "R7", "iu": "99000000000000021", "role": "agent", "service": "direction-des-passeports",
                                                        "code": "AG-0007", "statut": "actif"}]})
    assert any(r["id"] == "R7" for r in stockage._RefMemoire.racine["socle"]["roles"]), "l'admin crée les agents de son service"


def test_un_agent_ne_peut_pas_ouvrir_un_dossier_qui_le_concerne(socle):
    agent = connecter(socle, AGENT_PASSEPORTS)
    rep = socle.put("/etat", headers=agent, json={"dossiers": {"D-0100": {"id": "D-0100", "iu": AGENT_PASSEPORTS, "service": "direction-des-passeports"}}}).json()
    assert rep["refus"] == ["D-0100 (conflit d'intérêts)"]


def test_l_etat_ne_modifie_jamais_un_accord(socle):
    ouvrir_accord(socle, ADULTE_MARIE)
    agent = connecter(socle, AGENT_PASSEPORTS)
    socle.put("/etat", headers=agent, json={"dossiers": {"D-0001": {"id": "D-0001", "iu": ADULTE_MARIE, "service": "direction-des-passeports",
                                                                     "consent": {"statut": "actif", "autorisees": ["casier_judiciaire"]}}}})
    assert stockage._RefMemoire.racine["consentement"]["accords"]["D-0001"]["pieces"] == ["acte_naissance", "certificat_nationalite", "casier_vierge", "majeur"]
    assert "consent" not in stockage._RefMemoire.racine["socle"]["dossiers"]["D-0001"]


def test_il_reste_toujours_un_super_admin(socle):
    sa = connecter(socle, SUPER_ADMIN)
    rep = socle.put("/etat", headers=sa, json={"roles": [{"id": "R1", "iu": SUPER_ADMIN, "role": "super_admin", "statut": "revoque"}]}).json()
    assert "dernier super admin" in rep["refus"]


def test_le_mode_demonstration_est_annonce(socle, monkeypatch):
    """Les « données de test » de l'interface ne s'affichent qu'en démonstration."""
    assert socle.get("/session/mode").json() == {"demonstration": True}
    monkeypatch.setenv("SOCLE_DEMO", "0")
    assert socle.get("/session/mode").json() == {"demonstration": False}
