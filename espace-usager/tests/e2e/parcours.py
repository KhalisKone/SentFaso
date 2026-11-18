"""Test de bout en bout de l'espace usager, dans un vrai navigateur (Chrome sans fenêtre).

Démarre un socle en mémoire (aucun Firebase) et les registres simulés, branche les registres par la passerelle,
puis vérifie :
  1. les trois démarches de bout en bout, sans aucune pièce à fournir par l'usager (passeport, CNIB, concours) ;
  2. la consultation d'une pièce (lien court ouvert chez le registre) ;
  3. l'usager qui retrouve chaque échange et chaque consultation dans « Qui a consulté mes données » ;
  4. le citoyen n'a rien à accepter ni à régler : les pièces sont récupérées dès l'ouverture du dossier.

Lancer depuis la racine :  python3 espace-usager/tests/e2e/parcours.py        (E2E_VIDEO=dossier pour filmer)
Prérequis : espace-usager construit (npm run build), .venv du projet, Playwright et Google Chrome.
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path


RACINE = Path(__file__).resolve().parents[3]
PY = str(RACINE / ".venv" / "bin" / "python")
P_SOCLE, P_REG = 8193, 8194
SOCLE, REG = f"http://127.0.0.1:{P_SOCLE}", f"http://127.0.0.1:{P_REG}/registres"
SECRETS = {"registre-identite-simule": "s-identite", "mairie-de-ouagadougou": "s-etat-civil",
           "tribunal-de-ouagadougou": "s-justice", "registre-de-la-nationalite": "s-nationalite"}
CHEMINS = {"registre-identite-simule": "identite", "mairie-de-ouagadougou": "etat-civil",
           "tribunal-de-ouagadougou": "justice", "registre-de-la-nationalite": "nationalite"}
DEMARCHES = [  # service, nom de la démarche, admin, agent, pièces
    ("direction-des-passeports", "Demande de passeport", "99000000000000021", "99000000000000033",
     ["acte_naissance", "certificat_nationalite", "casier_vierge", "majeur"]),
    ("oni", "Établissement de la CNIB", "99000000000000022", "99000000000000034", ["acte_naissance", "certificat_nationalite", "majeur"]),
    ("ministere-de-la-fonction-publique", "Candidature à un concours", "99000000000000023", "99000000000000035",
     ["acte_naissance", "certificat_nationalite", "casier_judiciaire", "majeur"]),
]
CITOYEN = "99000000000000001"


def graine() -> dict:
    services = {"direction-des-passeports": "Direction des passeports", "oni": "Office national d'identification",
                "ministere-de-la-fonction-publique": "Ministère de la Fonction publique", "mairie-de-ouagadougou": "Mairie de Ouagadougou",
                "tribunal-de-ouagadougou": "Tribunal de grande instance de Ouagadougou", "registre-de-la-nationalite": "Registre de la nationalité",
                "registre-identite-simule": "Registre d'identité simulé"}
    roles = [{"id": "R1", "iu": CITOYEN, "role": "super_admin", "service": None, "code": "SA-0001", "statut": "actif"}]
    demarches = {}
    for i, (s, nom, admin, agent, pieces) in enumerate(DEMARCHES, 1):
        roles += [{"id": f"RA{i}", "iu": admin, "role": "admin", "service": s, "code": f"AD-000{i}", "statut": "actif"},
                  {"id": f"RG{i}", "iu": agent, "role": "agent", "service": s, "code": f"AG-000{i}", "statut": "actif"}]
        demarches[s] = {"DM-001": {"nom": nom, "finalite": f"Instruire la demande : {nom.lower()}", "base_legale": "Texte réglementaire (exemple)",
                                   "pieces": pieces, "duree": 30, "statut": "active"}}
    return {
        "socle": {"services": {k: {"nom": v, "statut": "actif"} for k, v in services.items()}, "roles": roles, "demarches": demarches},
        "branchements": {k: {"nom": services[k], "statut": "actif", "double_api": k == "registre-identite-simule", "secret": s, "connexion": None}
                         for k, s in SECRETS.items()},
    }


def attendre(url):
    for _ in range(60):
        try:
            urllib.request.urlopen(url, timeout=1)
            return
        except Exception:
            time.sleep(0.5)
    raise RuntimeError(f"{url} ne répond pas")


def poster(chemin, corps):
    req = urllib.request.Request(SOCLE + chemin, data=json.dumps(corps).encode(), method="POST", headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())


def demarrer():
    fichier = Path(tempfile.mkdtemp()) / "graine.json"
    fichier.write_text(json.dumps(graine()), encoding="utf-8")
    env_reg = {**os.environ, **{f"{p}_SECRET": SECRETS[s] for p, s in [("IDENTITE", "registre-identite-simule"), ("ETAT_CIVIL", "mairie-de-ouagadougou"),
                                                                       ("JUSTICE", "tribunal-de-ouagadougou"), ("NATIONALITE", "registre-de-la-nationalite")]},
               "ETAT_CIVIL_CONSOLE_JETON": "e2e"}
    env_socle = {**os.environ, "SOCLE_STOCKAGE": "memoire", "SOCLE_GRAINE": str(fichier), "SOCLE_DEMO": "1"}
    procs = [subprocess.Popen([PY, "-m", "uvicorn", "serveur:app", "--port", str(P_REG)], cwd=RACINE / "registres", env=env_reg,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL),
             subprocess.Popen([PY, "-m", "uvicorn", "main:app", "--port", str(P_SOCLE)], cwd=RACINE / "backend", env=env_socle,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)]
    attendre(f"{REG}/etat-civil/sante")
    attendre(f"{SOCLE}/connect/services")
    for sid, chemin in CHEMINS.items():  # branchement par la passerelle, comme sur /frontend/connect
        base = f"{REG}/{chemin}"
        corps = {"service_id": sid, "secret": SECRETS[sid], "url_documents": f"{base}/documents", "url_catalogue": f"{base}/catalogue",
                 "url_predicat": f"{base}/predicat", "url_lien": f"{base}/lien"}
        if sid == "registre-identite-simule":
            corps["url_verifier"] = f"{base}/verifier"
        assert poster("/connect/brancher", corps)["signature"] == "valide", sid
    return procs


# ── Navigateur ───────────────────────────────────────────────────────────────
def legende(pg, texte):
    """Bandeau explicatif (utile pour la vidéo)."""
    pg.evaluate("""t => { let b = document.getElementById('legende-e2e'); if (!b) { b = document.createElement('div'); b.id = 'legende-e2e';
      b.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:999;background:rgba(4,80,43,.95);color:#fff;'
        + 'padding:10px 18px;border-radius:12px;font:600 15px system-ui;box-shadow:0 8px 24px rgba(0,0,0,.25);border-left:6px solid #fcd116;max-width:80%';
      document.body.appendChild(b); } b.textContent = t; }""", texte)


def connecter(pg, iu, espace=None):
    pg.goto(SOCLE + "/frontend/")
    pg.evaluate("sessionStorage.clear()")
    pg.goto(SOCLE + "/frontend/")
    pg.fill("input[autocomplete=username]", iu)
    pg.click("text=Recevoir mon code")
    code = pg.inner_text(".code-demo", timeout=30000).strip()
    pg.fill("input[autocomplete=one-time-code]", code)
    pg.click("button:has-text('Se connecter')")
    if espace:
        pg.click(f".espaces >> text={espace}", timeout=30000)
    pg.wait_for_selector("aside .lien", timeout=30000)


def deconnecter(pg):
    pg.click("text=Se déconnecter")
    pg.wait_for_selector("text=Recevoir mon code", timeout=30000)


def ouvrir_dossier(pg, nom_demarche, nin):
    pg.click("aside >> text=Nouveau dossier")
    pg.wait_for_selector("#nd-iu", timeout=30000)
    pg.select_option(".etape select", label=nom_demarche)
    pg.fill("#nd-iu", nin)
    pg.click("text=Vérifier")
    pg.wait_for_selector(".etape .alerte", timeout=30000)
    pg.click("text=Ouvrir le dossier")
    pg.wait_for_selector("text=← Tous les dossiers", timeout=60000)
    pg.wait_for_function("() => !document.body.innerText.includes('Recherche en cours')", timeout=60000)
    return [r.split("\t") for r in pg.locator("tbody tr").all_inner_texts()]


def main():
    from playwright.sync_api import sync_playwright  # seul le test dans le navigateur en a besoin

    procs = demarrer()
    echecs = []

    def verifier(condition, texte):
        print(("  ✓ " if condition else "  ✗ ") + texte)
        if not condition:
            echecs.append(texte)

    video = os.environ.get("E2E_VIDEO")
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(executable_path="/usr/bin/google-chrome", slow_mo=250 if video else 0)
            ctx = b.new_context(viewport={"width": 1280, "height": 720}, **({"record_video_dir": video, "record_video_size": {"width": 1280, "height": 720}} if video else {}))
            pg = ctx.new_page()
            erreurs_js = []
            pg.on("pageerror", lambda e: erreurs_js.append(str(e)))

            print("1. Trois démarches sans pièce à fournir")
            for service, nom, _, agent, pieces in DEMARCHES:
                connecter(pg, agent, "Agent")
                legende(pg, f"{nom} : l'usager ne donne que son identifiant unique")
                lignes = ouvrir_dossier(pg, nom, CITOYEN)
                etats = {l[0]: l[1] for l in lignes}
                verifier(len(lignes) == len(pieces) and all(e.startswith(("Obtenue", "Répondu")) for e in etats.values()),
                         f"{nom} : {len(lignes)} pièce(s), toutes obtenues ({', '.join(e.split(' ')[0] for e in etats.values())})")
                pg.click("button:has-text('Consulter') >> nth=0")
                src = pg.get_attribute(".modale iframe", "src", timeout=30000)
                verifier(src.startswith(REG) and "sig=" in src, f"{nom} : pièce ouverte chez le registre par un lien signé")
                pg.keyboard.press("Escape")
                deconnecter(pg)

            print("2. L'usager retrouve les consultations dans son espace")
            connecter(pg, CITOYEN, "Citoyen")
            pg.click("aside >> text=Qui a consulté mes données")
            pg.wait_for_selector("tbody tr", timeout=30000)
            journal = pg.inner_text("tbody")
            legende(pg, "Le citoyen voit chaque échange et chaque consultation de ses données")
            verifier(journal.count("Pièce consultée") >= 3, "les 3 consultations des agents sont visibles")
            verifier("Lien de consultation délivré" in journal and "Échange avec un registre" in journal, "les échanges de la passerelle sont visibles")
            verifier(SOCLE and "Réponse minimale demandée" in journal, "les réponses minimales (majeur, casier vierge) sont visibles")
            deconnecter(pg)

            print("3. Le citoyen n'a rien à accepter ni à régler")
            connecter(pg, CITOYEN, "Citoyen")
            menu = pg.inner_text("aside")
            pg.wait_for_selector(".demande", timeout=30000)
            demandes = pg.inner_text("main")
            verifier("Paramètres" not in menu and "J'accepte" not in demandes and "Retirer mon accord" not in demandes,
                     "aucun paramètre ni bouton d'accord dans l'espace citoyen")
            deconnecter(pg)
            verifier(not erreurs_js, f"aucune erreur JavaScript ({len(erreurs_js)})")
            ctx.close()
            b.close()
    finally:
        for proc in procs:
            proc.terminate()
    print("\nRÉSULTAT :", "tout est vert" if not echecs else f"{len(echecs)} échec(s)")
    sys.exit(1 if echecs else 0)


if __name__ == "__main__":
    main()
