"""Usine à registre : chaque registre (état civil, justice, nationalité) est une application indépendante,
avec ses propres données, son propre code secret, son catalogue et SES règles d'accès.

Routes du contrat (toutes signées dans les deux sens, sauf /sante, /fichiers et /console) :
  GET /catalogue                     pièces et réponses proposées, services autorisés pour chacune
  GET /documents?iu=&types=          pièces détenues sur la personne (seulement les types demandés et autorisés)
  GET /predicat?iu=&q=               réponse minimale oui/non (ex. majeur) sans transmettre la donnée source
  GET /lien?iu=&document=            lien court et signé vers le fichier, redemandé à chaque consultation
Contexte transmis par la passerelle sur chaque appel (et couvert par sa signature) : demandeur, dossier, finalite.
Le registre refuse (403) un demandeur que ses règles n'autorisent pas.

Configuration par variables d'environnement, préfixées (ex. ETAT_CIVIL_) :
  _SECRET (obligatoire)   code secret remis par le super admin du socle pour ce service
  _SERVICE                identifiant du service dans le socle (vérifié dans X-Socle-Service)
  _URL_PUBLIQUE           adresse publique du registre, pour construire les liens vers les fichiers
  _CONSOLE_JETON          active la console de supervision (/console?jeton=…)
  _AUTORISATIONS          règles d'accès en JSON, ex. {"casier_judiciaire": ["direction-des-passeports"]}
"""
import html
import json
import os
import time
from collections import deque
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Callable
from urllib.parse import urlencode

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import HTMLResponse, RedirectResponse

from commun.pdf import document as pdf_document
from commun.securite import reponse_signee, signer_lien, verifier_appel, verifier_lien

IU_TEST = "0" * 17            # identifiant de test du socle : ne correspond à personne, réponse toujours vide
DUREE_LIEN_LISTE = 15 * 60   # lien joint à la liste des documents
DUREE_LIEN_COURT = 5 * 60    # lien redemandé au moment de la consultation


def age(personne: dict, aujourdhui: date | None = None) -> int:
    n = date.fromisoformat(personne["date_naissance"])
    a = aujourdhui or date.today()
    return a.year - n.year - ((a.month, a.day) < (n.month, n.day))


class Registre:
    def __init__(self, *, nom: str, autorite: str, prefixe: str, service: str, dossier: Path,
                 predicats: dict[str, Callable[[dict], bool]], autorisations: dict[str, list[str]], description: str,
                 verification: bool = False):
        self.nom, self.autorite, self.prefixe = nom, autorite, prefixe
        env = lambda cle, defaut=None: os.environ.get(f"{prefixe}_{cle}", defaut)
        self.secret = env("SECRET")
        self.service = env("SERVICE", service)
        self.url_publique = (env("URL_PUBLIQUE") or "").rstrip("/")
        self.jeton_console = env("CONSOLE_JETON")
        self.autorisations = {**autorisations, **json.loads(env("AUTORISATIONS", "{}"))}
        donnees = json.loads((dossier / "donnees.json").read_text(encoding="utf-8"))
        self.personnes: dict = donnees["personnes"]
        self.documents: dict = donnees["documents"]
        self.par_id = {d["id"]: (nin, d) for nin, docs in self.documents.items() for d in docs}
        self.types = sorted({d["type"] for docs in self.documents.values() for d in docs})
        self.predicats = predicats
        self.verification = verification
        self.panne = False
        self.trace = deque(maxlen=40)
        self.app = self._application(description)

    # ── Règles ──────────────────────────────────────────────────────────────
    def autorise(self, code: str, demandeur: str | None) -> bool:
        regle = self.autorisations.get(code, self.autorisations.get("*", ["*"]))
        return "*" in regle or (demandeur or "") in regle

    def _controler(self, req: Request):
        if not self.secret:
            raise HTTPException(503, "Registre non configuré (code secret absent).")
        if self.panne:
            raise HTTPException(503, "Registre momentanément indisponible.")
        appelant = verifier_appel(req, self.secret)
        if appelant and appelant != self.service:
            raise HTTPException(401, "Appel destiné à un autre service.")

    def _tracer(self, req: Request, route: str, resultat: str):
        q = req.query_params
        self.trace.appendleft({
            "ts": datetime.now(timezone.utc).strftime("%d/%m %H:%M:%S"), "route": route, "resultat": resultat,
            "demandeur": q.get("demandeur", "—"), "dossier": q.get("dossier", "—"), "finalite": q.get("finalite", "—"),
            "iu": ("…" + q["iu"][-4:]) if q.get("iu") else "—",
        })

    def _lien(self, req: Request, doc_id: str, iu: str, duree: int) -> tuple[str, int]:
        expire = int(time.time()) + duree
        # Adresse du registre = chemin de la requête sans sa dernière partie (/documents, /lien) : le préfixe de montage
        # (ex. /registres/etat-civil) est conservé, ce que base_url ne garantit pas pour une application montée.
        base = self.url_publique or f"{req.url.scheme}://{req.url.netloc}{req.url.path.rsplit('/', 1)[0]}"
        return f"{base}/fichiers/{doc_id}?" + urlencode({"iu": iu, "exp": expire, "sig": signer_lien(self.secret, doc_id, iu, expire)}), expire

    # ── Application ─────────────────────────────────────────────────────────
    def _application(self, description: str) -> FastAPI:
        app = FastAPI(title=self.nom, version="2.0", description=description)
        reg = self

        @app.get("/sante", tags=["supervision"], summary="État du registre (public)")
        def sante():
            return {"registre": reg.nom, "service": reg.service, "disponible": not reg.panne, "personnes": len(reg.personnes)}

        @app.get("/catalogue", tags=["contrat"], summary="Pièces et réponses proposées, et services autorisés")
        def catalogue(req: Request):
            reg._controler(req)
            return reponse_signee(req, {
                "service": reg.service, "nom": reg.nom, "types": reg.types, "predicats": sorted(reg.predicats),
                "autorisations": {c: reg.autorisations.get(c, reg.autorisations.get("*", ["*"])) for c in [*reg.types, *reg.predicats]},
            }, reg.secret)

        @app.get("/documents", tags=["contrat"], summary="Pièces détenues sur une personne")
        def documents(req: Request, iu: str, types: str | None = None, demandeur: str | None = None,
                      dossier: str | None = None, finalite: str | None = None):
            reg._controler(req)
            if iu == IU_TEST:
                reg._tracer(req, "documents", "test de branchement")
                return reponse_signee(req, [], reg.secret)
            demandes = [t for t in (types.split(",") if types else reg.types) if t in reg.types]
            permis = [t for t in demandes if reg.autorise(t, demandeur)]
            if demandes and not permis:
                reg._tracer(req, "documents", "refusé (règle d'accès)")
                return reponse_signee(req, {"detail": f"Service « {demandeur} » non autorisé par {reg.nom}."}, reg.secret, 403)
            docs = []
            for d in reg.documents.get(iu, []):
                if d["type"] in permis:
                    url, _ = reg._lien(req, d["id"], iu, DUREE_LIEN_LISTE)
                    docs.append({"id": d["id"], "type": d["type"], "titre": d["titre"], "date": d.get("date"), "url": url})
            reg._tracer(req, "documents", f"{len(docs)} document(s)")
            return reponse_signee(req, docs, reg.secret)

        if reg.verification:
            @app.get("/verifier", tags=["contrat"], summary="Vérifier un identifiant unique (registre d'identité)")
            def verifier(req: Request, iu: str, demandeur: str | None = None):
                reg._controler(req)
                p = reg.personnes.get(iu)
                valide = bool(p) and p.get("compte") == "actif"
                reg._tracer(req, "verifier", "reconnu" if valide else "inconnu ou compte inactif")
                return reponse_signee(req, {"valide": True, "nom": p["nom"], "prenoms": p["prenoms"]} if valide else {"valide": False}, reg.secret)

        @app.get("/predicat", tags=["contrat"], summary="Réponse minimale oui/non (la donnée source n'est pas transmise)")
        def predicat(req: Request, iu: str, q: str, demandeur: str | None = None, dossier: str | None = None, finalite: str | None = None):
            reg._controler(req)
            if q not in reg.predicats:
                raise HTTPException(404, f"Réponse « {q} » non proposée par ce registre.")
            if iu == IU_TEST:
                reg._tracer(req, f"predicat {q}", "test de branchement")
                return reponse_signee(req, {"q": q, "reponse": None}, reg.secret)
            if not reg.autorise(q, demandeur):
                reg._tracer(req, f"predicat {q}", "refusé (règle d'accès)")
                return reponse_signee(req, {"detail": f"Service « {demandeur} » non autorisé par {reg.nom}."}, reg.secret, 403)
            personne = reg.personnes.get(iu)
            reponse = reg.predicats[q](personne) if personne else None
            reg._tracer(req, f"predicat {q}", "inconnu" if reponse is None else ("oui" if reponse else "non"))
            return reponse_signee(req, {"q": q, "reponse": reponse}, reg.secret)

        @app.get("/lien", tags=["contrat"], summary="Lien court et signé vers le fichier d'une pièce")
        def lien(req: Request, iu: str, document: str, demandeur: str | None = None, dossier: str | None = None, finalite: str | None = None):
            reg._controler(req)
            nin, d = reg.par_id.get(document, (None, None))
            if not d or nin != iu:
                raise HTTPException(404, "Pièce introuvable pour cette personne.")
            if not reg.autorise(d["type"], demandeur):
                reg._tracer(req, "lien", "refusé (règle d'accès)")
                return reponse_signee(req, {"detail": f"Service « {demandeur} » non autorisé par {reg.nom}."}, reg.secret, 403)
            url, expire = reg._lien(req, document, iu, DUREE_LIEN_COURT)
            reg._tracer(req, "lien", f"lien délivré ({DUREE_LIEN_COURT // 60} min)")
            return reponse_signee(req, {"url": url, "expire": datetime.fromtimestamp(expire, timezone.utc).isoformat()}, reg.secret)

        @app.get("/fichiers/{document}", tags=["fichiers"], summary="Fichier PDF d'une pièce (lien signé, durée limitée)")
        def fichier(document: str, iu: str, exp: str = "", sig: str = ""):
            verifier_lien(reg.secret or "", document, iu, exp, sig)
            nin, d = reg.par_id.get(document, (None, None))
            if not d or nin != iu:
                raise HTTPException(404)
            return Response(pdf_document(reg.autorite, d["titre"], [tuple(x) for x in d["champs"]], d["id"]), media_type="application/pdf",
                            headers={"Cache-Control": "no-store", "Content-Disposition": f'inline; filename="{d["id"]}.pdf"'})

        # ── Console de supervision du registre (démonstration de panne, trace locale des appels) ──
        def jeton_valide(jeton: str):
            if not reg.jeton_console or jeton != reg.jeton_console:
                raise HTTPException(404)

        @app.get("/console", tags=["supervision"], response_class=HTMLResponse, include_in_schema=False)
        def console(jeton: str = Query("")):
            jeton_valide(jeton)
            lignes = "".join(
                f"<tr><td>{html.escape(t['ts'])}</td><td>{html.escape(t['route'])}</td><td>{html.escape(t['demandeur'])}</td>"
                f"<td>{html.escape(t['dossier'])}</td><td>{html.escape(t['finalite'])}</td><td>{html.escape(t['iu'])}</td><td>{html.escape(t['resultat'])}</td></tr>"
                for t in reg.trace) or "<tr><td colspan=7>Aucun appel pour l'instant.</td></tr>"
            regles = "".join(f"<li><code>{html.escape(c)}</code> : {html.escape(', '.join(v))}</li>" for c, v in reg.autorisations.items())
            etat = ("<b style='color:#c4161c'>EN PANNE (simulée)</b>", 0, "Rétablir le registre") if reg.panne else ("<b style='color:#007a3d'>Disponible</b>", 1, "Simuler une panne")
            return f"""<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="10"><title>Console — {html.escape(reg.nom)}</title>
<style>body{{font:15px/1.5 system-ui,sans-serif;margin:0;background:#f3f5f1;color:#13201a}}header{{border-top:6px solid #ef2b2d;border-bottom:1px solid #ddd;background:#fff;padding:14px 20px}}
main{{padding:16px 20px;max-width:1100px}}.carte{{background:#fff;border:1px solid #e3e3e3;border-radius:14px;padding:16px;margin-bottom:14px;overflow-x:auto}}
table{{border-collapse:collapse;width:100%;font-size:13px}}td,th{{border-bottom:1px solid #eee;padding:6px;text-align:left}}button{{background:#007a3d;color:#fff;border:0;border-radius:999px;padding:9px 18px;font-weight:700;cursor:pointer}}</style></head>
<body><header><b>{html.escape(reg.nom)}</b><br><small>Console du registre · service <code>{html.escape(reg.service)}</code> · {len(reg.personnes)} personnes</small></header><main>
<div class="carte">État : {etat[0]} <form method="post" action="console/panne?jeton={html.escape(jeton)}&active={etat[1]}" style="display:inline;margin-left:12px"><button>{etat[2]}</button></form></div>
<div class="carte"><b>Règles d'accès décidées par ce registre</b><ul>{regles}</ul></div>
<div class="carte"><b>Derniers appels reçus de la passerelle</b> (le registre garde sa propre trace)
<table><tr><th>Quand (UTC)</th><th>Route</th><th>Demandeur</th><th>Dossier</th><th>Finalité</th><th>NIN</th><th>Résultat</th></tr>{lignes}</table></div></main></body></html>"""

        @app.post("/console/panne", tags=["supervision"], include_in_schema=False)
        def basculer_panne(jeton: str = Query(""), active: int = Query(1)):
            jeton_valide(jeton)
            reg.panne = bool(active)
            return RedirectResponse(f"../console?jeton={jeton}", status_code=303)

        return app
