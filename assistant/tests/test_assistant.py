"""Assistant : boucle d'outils, compétences exécutées avec les droits de la personne, historique, mode sans connexion.
Le modèle est remplacé par un faux client (aucun appel réel, aucun coût)."""
import json

import pytest

from assistant import api, competences
from banc_essai import ADULTE_MARIE, AGENT_PASSEPORTS, SUPER_ADMIN, brancher_registre, connecter, ouvrir_accord


class Bloc:
    def __init__(self, **champs):
        self.__dict__.update(champs)

    def to_dict(self):
        return dict(self.__dict__)


class Reponse:
    def __init__(self, contenu, stop_reason):
        self.content, self.stop_reason = contenu, stop_reason


class FauxModele:
    """Joue un scénario : d'abord les appels de compétences prévus, puis une réponse texte. Garde chaque requête."""

    def __init__(self, appels=()):
        self.appels, self.requetes = list(appels), []
        self.messages = self

    async def create(self, **requete):
        self.requetes.append(requete)
        if self.appels:
            nom, entree = self.appels.pop(0)
            return Reponse([Bloc(type="tool_use", id=f"t{len(self.requetes)}", name=nom, input=entree)], "tool_use")
        resultats = [b for m in requete["messages"] if m["role"] == "user" and isinstance(m["content"], list)
                     for b in m["content"] if b.get("type") == "tool_result"]
        return Reponse([Bloc(type="text", text=f"Voici : {resultats[-1]['content'] if resultats else 'bonjour'}")], "end_turn")


@pytest.fixture
def modele(monkeypatch):
    def installer(appels=()):
        monkeypatch.setenv("ASSISTANT_FOURNISSEUR", "anthropic")
        faux = FauxModele(appels)
        monkeypatch.setattr(api, "client", lambda: faux)
        api._usage.clear()
        return faux
    return installer


def test_les_competences_dependent_du_role(socle):
    citoyen = {c["nom"] for c in socle.get("/assistant/competences", headers=connecter(socle, ADULTE_MARIE)).json()}
    agent = {c["nom"] for c in socle.get("/assistant/competences", headers=connecter(socle, AGENT_PASSEPORTS)).json()}
    sa = {c["nom"] for c in socle.get("/assistant/competences", headers=connecter(socle, SUPER_ADMIN)).json()}
    assert "mes_demandes" in citoyen and "verifier_une_identite" not in citoyen and "tester_les_registres" not in citoyen
    assert {"verifier_une_identite", "dossiers_du_service", "detail_d_un_dossier"} <= agent
    assert "tester_les_registres" in sa and "dossiers_du_service" not in sa, "le super admin ne voit aucun dossier"
    assert socle.get("/assistant/competences").json() == [], "sans connexion : aucune compétence"


def test_une_question_avec_competence_puis_historique(socle, modele):
    ouvrir_accord(socle, ADULTE_MARIE)
    import stockage
    stockage._RefMemoire.racine["socle"]["dossiers"] = {"D-0001": {"id": "D-0001", "iu": ADULTE_MARIE, "service": "direction-des-passeports",
                                                                   "finalite": "Demande de passeport", "statut": "autorise", "pieces": {"majeur": {"statut": "repondu", "valeur": True}}}}
    faux = modele([("mes_demandes", {})])
    citoyen = connecter(socle, ADULTE_MARIE)
    r = socle.post("/assistant/message", headers=citoyen, json={"message": "Où en est mon passeport ?", "page": "/frontend/citoyen/demandes"}).json()
    assert "D-0001" in r["reponse"]["texte"] and "Demande de passeport" in r["reponse"]["texte"]
    assert r["reponse"]["competences"] == ["📄 Mes demandes"]
    requete = faux.requetes[0]
    assert requete["model"] == "claude-haiku-5-5" and {o["name"] for o in requete["tools"]} >= {"mes_demandes"}
    assert requete["system"][0]["cache_control"] == {"type": "ephemeral"} and "espace citoyen" in requete["system"][1]["text"]
    # Suite de la conversation : l'historique complet (blocs d'outils compris) est renvoyé au modèle.
    modele()
    suite = socle.post("/assistant/message", headers=citoyen, json={"message": "Merci", "conversation": r["conversation"]}).json()
    assert suite["conversation"] == r["conversation"]
    [conv] = socle.get("/assistant/conversations", headers=citoyen).json()
    assert conv["titre"] == "Où en est mon passeport ?" and conv["messages"] == 4
    fil = socle.get(f"/assistant/conversations/{r['conversation']}", headers=citoyen).json()["fil"]
    assert [m["role"] for m in fil] == ["user", "assistant", "user", "assistant"]
    assert socle.get(f"/assistant/conversations/{r['conversation']}", headers=connecter(socle, SUPER_ADMIN)).status_code == 404, "historique privé"


def test_une_competence_hors_du_role_est_refusee(socle, modele):
    modele([("verifier_une_identite", {"nin": SUPER_ADMIN})])
    r = socle.post("/assistant/message", headers=connecter(socle, ADULTE_MARIE), json={"message": "Vérifie ce NIN"}).json()
    assert "non disponible pour votre rôle" in r["reponse"]["texte"]


def test_l_agent_verifie_une_identite_et_c_est_journalise(socle, modele):
    modele([("verifier_une_identite", {"nin": ADULTE_MARIE})])
    agent = connecter(socle, AGENT_PASSEPORTS)
    r = socle.post("/assistant/message", headers=agent, json={"message": f"Vérifie le NIN {ADULTE_MARIE}"}).json()
    assert "KABORE" in r["reponse"]["texte"] or "reconnu" in r["reponse"]["texte"]
    lignes = socle.get("/journal", headers=connecter(socle, ADULTE_MARIE)).json()
    assert any(l["action"] == "Vérification d'identité" and l.get("service") == "direction-des-passeports" for l in lignes)


def test_le_super_admin_teste_les_registres(socle, modele):
    brancher_registre(socle, "mairie-de-ouagadougou")
    modele([("tester_les_registres", {})])
    r = socle.post("/assistant/message", headers=connecter(socle, SUPER_ADMIN), json={"message": "Les registres répondent-ils ?"}).json()
    assert "vérifiée" in r["reponse"]["texte"] and "true" in r["reponse"]["texte"]


def test_sans_connexion_aucune_competence_et_rien_n_est_enregistre(socle, modele):
    faux = modele()
    r = socle.post("/assistant/public", json={"message": "Comment ça marche ?", "historique": [{"role": "assistant", "texte": "Bonjour"}]}).json()
    assert r["reponse"]["texte"] and "tools" not in faux.requetes[0]
    assert faux.requetes[0]["messages"][0]["role"] == "user", "l'historique commence toujours par l'usager"
    assert socle.post("/assistant/message", json={"message": "x"}).status_code == 401


def test_quota_de_messages(socle, modele):
    modele()
    api.QUOTA["anonyme"] = (2, 3600)
    try:
        codes = [socle.post("/assistant/public", json={"message": "Bonjour"}).status_code for _ in range(3)]
        assert codes == [200, 200, 429]
    finally:
        api.QUOTA["anonyme"] = (12, 3600)


def test_competence_qui_echoue_renvoie_une_erreur_lisible():
    import asyncio
    from session import Personne

    class Bidon(Personne):
        def __init__(self):
            self.iu, self.roles = "x", []
    res, erreur = asyncio.run(competences.executer(Bidon(), "detail_d_un_dossier", {"numero": "D-9"}))
    assert erreur and "non disponible" in json.loads(res)["erreur"]


def test_l_historique_rejoue_reste_valide_pour_l_api():
    """La base supprime les objets vides : l'entrée {} d'une compétence sans paramètre doit être rétablie."""
    messages = [{"role": "assistant", "content": [{"type": "tool_use", "id": "t1", "name": "mes_demandes", "input": None}]},
                {"role": "assistant", "content": [{"type": "tool_use", "id": "t2", "name": "mes_demandes"}, {"type": "text"}]}]
    api.reparer(messages)
    assert messages[0]["content"][0]["input"] == {} and messages[1]["content"][0]["input"] == {} and messages[1]["content"][1]["text"] == ""



# ── Fournisseur choisi dans le .env ──────────────────────────────────────────
def test_assistant_desactive_par_configuration(socle, monkeypatch):
    monkeypatch.setenv("ASSISTANT_FOURNISSEUR", "aucun")
    api._usage.clear()
    assert socle.get("/assistant/etat").json()["actif"] is False, "le front masque alors la mascotte"
    assert socle.post("/assistant/public", json={"message": "Bonjour"}).status_code == 503


def test_fournisseur_compatible_openai_avec_appel_de_competence(socle, monkeypatch):
    """Format « chat/completions » (Mistral, Ollama…) : la compétence est exécutée avec les droits de la personne."""
    import httpx
    monkeypatch.setenv("ASSISTANT_FOURNISSEUR", "compatible-openai")
    monkeypatch.setenv("ASSISTANT_URL", "http://modele.test/v1")
    monkeypatch.setenv("ASSISTANT_MODELE", "mistral-small")
    api._usage.clear()
    requetes = []

    def repondre(req: httpx.Request):
        corps = json.loads(req.content)
        requetes.append(corps)
        if len(requetes) == 1:
            appel = {"id": "c1", "type": "function", "function": {"name": "mes_demandes", "arguments": "{}"}}
            return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": None, "tool_calls": [appel]}, "finish_reason": "tool_calls"}]})
        resultat = next(m for m in corps["messages"] if m["role"] == "tool")
        return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": f"Reçu : {resultat['content'][:20]}"}, "finish_reason": "stop"}]})

    monkeypatch.setattr(api, "client_http", lambda: httpx.AsyncClient(transport=httpx.MockTransport(repondre)))
    ouvrir_accord(socle, ADULTE_MARIE)
    rep = socle.post("/assistant/message", headers=connecter(socle, ADULTE_MARIE), json={"message": "Où en sont mes demandes ?"}).json()
    assert rep["reponse"]["texte"].startswith("Reçu : ") and rep["reponse"]["competences"], rep
    assert requetes[0]["model"] == "mistral-small" and requetes[0]["messages"][0]["role"] == "system"
    assert {o["function"]["name"] for o in requetes[0]["tools"]} >= {"mes_demandes"}
    assert socle.get("/assistant/etat").json() == {"actif": True, "fournisseur": "compatible-openai", "modele": "mistral-small"}
