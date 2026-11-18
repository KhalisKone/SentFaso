"""Tests d'un registre seul : authentification de l'appel, signature de la réponse, minimisation,
règles d'accès propres au registre, réponses minimales, liens courts, panne simulée."""
import hashlib
import hmac
import time
from urllib.parse import urlencode

import pytest
from fastapi.testclient import TestClient

import serveur
from etat_civil.app import registre as etat_civil
from justice.app import registre as justice

SECRET = "secret-de-test"
ADULTE_MARIE, MINEUR, CONDAMNE, INCONNU = "99000000000000003", "99000000000000002", "99000000000000017", "99000000000000999"


@pytest.fixture(autouse=True)
def remise_a_zero():
    for r in (etat_civil, justice):
        r.secret, r.panne = SECRET, False
        r.trace.clear()


@pytest.fixture
def client():
    return TestClient(serveur.app)


def appel(client, registre, route, service, secret=SECRET, **params):
    chemin = f"/registres/{registre}/{route}" + ("?" + urlencode(params) if params else "")
    ts = str(int(time.time()))
    sig = hmac.new(secret.encode(), f"{ts}\nGET\n{chemin}".encode(), hashlib.sha256).hexdigest()
    return client.get(chemin, headers={"X-Socle-Service": service, "X-Socle-Horodatage": ts, "X-Socle-Signature": sig})


def signature_valide(r) -> bool:
    chemin = r.request.url.path + ("?" + r.request.url.query.decode() if isinstance(r.request.url.query, bytes) else ("?" + r.request.url.query if r.request.url.query else ""))
    ts = r.headers["X-Registre-Horodatage"]
    attendue = hmac.new(SECRET.encode(), f"{ts}\n{chemin}\n{hashlib.sha256(r.content).hexdigest()}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(attendue, r.headers["X-Registre-Signature"])


def test_un_appel_non_signe_ou_mal_signe_est_refuse(client):
    assert client.get(f"/registres/etat-civil/documents?iu={ADULTE_MARIE}").status_code == 401
    assert appel(client, "etat-civil", "documents", "mairie-de-ouagadougou", secret="autre", iu=ADULTE_MARIE).status_code == 401
    assert appel(client, "etat-civil", "documents", "un-autre-service", iu=ADULTE_MARIE).status_code == 401


def test_la_reponse_est_signee_et_limitee_aux_types_demandes(client):
    r = appel(client, "etat-civil", "documents", "mairie-de-ouagadougou", iu=ADULTE_MARIE, types="acte_naissance")
    assert r.status_code == 200 and signature_valide(r)
    assert [d["type"] for d in r.json()] == ["acte_naissance"]
    tout = appel(client, "etat-civil", "documents", "mairie-de-ouagadougou", iu=ADULTE_MARIE).json()
    assert {d["type"] for d in tout} == {"acte_naissance", "acte_mariage"}
    assert appel(client, "etat-civil", "documents", "mairie-de-ouagadougou", iu=INCONNU).json() == []


def test_le_registre_applique_ses_propres_regles(client):
    refus = appel(client, "justice", "documents", "tribunal-de-ouagadougou", iu=ADULTE_MARIE, types="casier_judiciaire", demandeur="mairie-de-ouagadougou")
    assert refus.status_code == 403 and signature_valide(refus)
    ok = appel(client, "justice", "documents", "tribunal-de-ouagadougou", iu=ADULTE_MARIE, types="casier_judiciaire", demandeur="direction-des-passeports")
    assert [d["type"] for d in ok.json()] == ["casier_judiciaire"]
    vierge = appel(client, "justice", "predicat", "tribunal-de-ouagadougou", iu=CONDAMNE, q="casier_vierge", demandeur="mairie-de-ouagadougou")
    assert vierge.json() == {"q": "casier_vierge", "reponse": False}, "la réponse minimale reste ouverte à tous"


def test_reponse_minimale_majeur(client):
    rep = lambda iu: appel(client, "etat-civil", "predicat", "mairie-de-ouagadougou", iu=iu, q="majeur").json()["reponse"]
    assert (rep(ADULTE_MARIE), rep(MINEUR), rep(INCONNU)) == (True, False, None)


def test_le_nin_de_test_repond_vide_quelles_que_soient_les_regles(client):
    r = appel(client, "justice", "documents", "tribunal-de-ouagadougou", iu="0" * 17, types="casier_judiciaire", demandeur="test-de-branchement")
    assert r.status_code == 200 and r.json() == []


def test_lien_court_vers_un_pdf_et_expiration(client):
    lien = appel(client, "etat-civil", "lien", "mairie-de-ouagadougou", iu=ADULTE_MARIE, document="AN-1995-00003").json()
    chemin = lien["url"].split("testserver", 1)[1]
    pdf = client.get(chemin)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF") and b"SPECIMEN" in pdf.content
    assert client.get(chemin.replace(f"iu={ADULTE_MARIE}", f"iu={MINEUR}")).status_code == 403, "un lien ne vaut que pour sa personne"
    expire = "/registres/etat-civil/fichiers/AN-1995-00003?" + urlencode({"iu": ADULTE_MARIE, "exp": int(time.time()) - 1, "sig": "x"})
    assert client.get(expire).status_code == 403


def test_panne_simulee_depuis_la_console(client):
    assert client.get("/registres/etat-civil/console").status_code == 404, "console fermée sans jeton"
    client.post("/registres/etat-civil/console/panne?jeton=jeton-test&active=1", follow_redirects=False)
    assert appel(client, "etat-civil", "documents", "mairie-de-ouagadougou", iu=ADULTE_MARIE).status_code == 503
    client.post("/registres/etat-civil/console/panne?jeton=jeton-test&active=0", follow_redirects=False)
    assert appel(client, "etat-civil", "documents", "mairie-de-ouagadougou", iu=ADULTE_MARIE).status_code == 200
    assert "mairie-de-ouagadougou" in client.get("/registres/etat-civil/console?jeton=jeton-test").text


def test_catalogue(client):
    cat = appel(client, "justice", "catalogue", "tribunal-de-ouagadougou").json()
    assert cat["types"] == ["casier_judiciaire"] and cat["predicats"] == ["casier_vierge"]
    assert cat["autorisations"]["casier_vierge"] == ["*"]
