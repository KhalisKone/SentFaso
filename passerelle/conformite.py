"""Banc de conformité et santé des registres : la preuve qu'un registre tiers respecte le contrat, sans nous.

Le banc appelle le registre comme la passerelle le fait, puis tente des appels qu'il DOIT refuser (non signé, mal signé,
destiné à un autre service, horodatage périmé). Il n'utilise que l'identifiant de test (00000000000000000) et un identifiant
fictif (00000000000000001) : aucune donnée de citoyen n'est demandée.

Chaque critère : {"id", "critere", "niveau": "obligatoire" | "recommande", "ok": bool | None (non applicable), "detail"}.
Conforme = tous les critères obligatoires sont remplis.
"""
import asyncio
import hashlib
import json
import hmac
import time
from urllib.parse import urlencode

import httpx

from passerelle import adaptateur as adapt
from passerelle.appels import DELAI
from passerelle.securite import FENETRE, chemin_de, entetes, signature_reponse

IU_TEST = "00000000000000000"
IU_FICTIF = "00000000000000001"  # ne correspond à personne : sert au contrôle des règles d'accès
DEMANDEUR_INCONNU = "service-non-autorise-banc-de-conformite"
VOCABULAIRE = {"acte_naissance", "acte_mariage", "certificat_nationalite", "casier_judiciaire", "certificat_residence",
               "photo_identite", "majeur", "casier_vierge"}


def _url(base: str, params: dict, adaptateur: dict | None) -> str:
    reglages = adapt.completer(adaptateur)
    q = {k: v for k, v in params.items() if v not in (None, "")}
    if "iu" in q and reglages["parametre_iu"] != "iu":
        q[reglages["parametre_iu"]] = q.pop("iu")
    return f"{base}?{urlencode(q)}" if q else base


def _signature(secret: str, url: str, r: httpx.Response) -> tuple[bool | None, str]:
    """(valide ?, explication) ; None si la réponse n'est pas signée."""
    recue, ts = r.headers.get("X-Registre-Signature"), r.headers.get("X-Registre-Horodatage", "")
    if not recue:
        return None, "réponse non signée (en-têtes X-Registre-Horodatage et X-Registre-Signature absents)"
    if not ts.isdigit() or abs(time.time() - int(ts)) > FENETRE:
        return False, "horodatage de la réponse absent ou décalé de plus de 5 minutes"
    if not hmac.compare_digest(signature_reponse(secret, ts, chemin_de(url), r.content), recue):
        return False, "signature de la réponse invalide"
    return True, "signature vérifiée"


def _entetes_alteres(service_id: str, secret: str, url: str, facon: str) -> dict:
    h = entetes(service_id, secret, url)
    if facon == "sans":
        return {}
    if facon == "fausse":
        return {**h, "X-Socle-Signature": hashlib.sha256(b"fausse").hexdigest()}
    if facon == "autre-service":  # signature juste, mais pour un autre service
        autre = "un-autre-service"
        return entetes(autre, secret, url)
    if facon == "perime":
        ts = str(int(time.time()) - 3 * FENETRE)
        sig = hmac.new(secret.encode(), f"{ts}\nGET\n{chemin_de(url)}".encode(), hashlib.sha256).hexdigest()
        return {**h, "X-Socle-Horodatage": ts, "X-Socle-Signature": sig}
    return h


async def _get(client: httpx.AsyncClient, url: str, headers: dict) -> tuple[httpx.Response | None, float, str | None]:
    debut = time.monotonic()
    try:
        r = await client.get(url, headers=headers, timeout=DELAI)
        return r, (time.monotonic() - debut) * 1000, None
    except httpx.TimeoutException:
        return None, (time.monotonic() - debut) * 1000, f"pas de réponse en {DELAI} s"
    except Exception as e:
        return None, (time.monotonic() - debut) * 1000, str(e) or e.__class__.__name__


async def banc(client: httpx.AsyncClient, service_id: str, secret: str, urls: dict, adaptateur: dict | None = None,
               double_api: bool = False) -> dict:
    """Passe le registre au banc. urls : documents (obligatoire), catalogue, predicat, verifier."""
    criteres = []

    def noter(cid, critere, niveau, ok, detail):
        criteres.append({"id": cid, "critere": critere, "niveau": niveau, "ok": ok, "detail": detail})

    u_docs = _url(urls["documents"], {"iu": IU_TEST, "demandeur": "banc-de-conformite"}, adaptateur)

    # 1. La route documents répond, vite, au bon format, signée.
    r, ms, err = await _get(client, u_docs, entetes(service_id, secret, u_docs))
    repond = r is not None and r.status_code == 200
    noter("documents", "La route /documents répond à un appel signé", "obligatoire", repond,
          f"HTTP {r.status_code}" if r is not None else err)
    noter("delai", f"Réponse en moins de {DELAI} s (au-delà, la pièce passe « indisponible »)", "obligatoire",
          r is not None, f"{ms:.0f} ms" + (" : lent, la démonstration risque d'attendre" if r is not None and ms > 3000 else ""))
    if repond:
        try:
            liste = adapt.documents(r.json(), adaptateur)
            vide = isinstance(liste, list) and not liste
            noter("test-vide", "L'identifiant de test renvoie une liste vide", "obligatoire", vide,
                  "[]" if vide else f"réponse reçue : {str(r.text)[:120]}")
        except Exception as e:
            noter("test-vide", "L'identifiant de test renvoie une liste vide", "obligatoire", False, f"format illisible : {e}")
        ok, detail = _signature(secret, u_docs, r)
        noter("signature", "Réponses signées (X-Registre-Signature) et vérifiables", "obligatoire", bool(ok), detail)

    # 2. Les appels illégitimes sont refusés.
    for cid, facon, critere, niveau in [
        ("refus-non-signe", "sans", "Un appel non signé est refusé", "obligatoire"),
        ("refus-mal-signe", "fausse", "Un appel mal signé est refusé", "obligatoire"),
        ("refus-autre-service", "autre-service", "Un appel au nom d'un autre service est refusé", "recommande"),
        ("refus-perime", "perime", "Un appel à l'horodatage périmé (rejeu) est refusé", "recommande"),
    ]:
        rr, _, e = await _get(client, u_docs, _entetes_alteres(service_id, secret, u_docs, facon))
        refuse = rr is not None and rr.status_code in (401, 403)
        noter(cid, critere, niveau, refuse, f"HTTP {rr.status_code}" + ("" if refuse else " : l'appel a été accepté") if rr is not None else e)

    # 3. Catalogue et règles d'accès décidées par le registre.
    catalogue = None
    if urls.get("catalogue"):
        rc, _, e = await _get(client, urls["catalogue"], entetes(service_id, secret, urls["catalogue"]))
        try:
            catalogue = rc.json() if rc is not None and rc.status_code == 200 else None
        except Exception:
            catalogue = None
        valide = isinstance(catalogue, dict) and isinstance(catalogue.get("types"), list)
        noter("catalogue", "Catalogue publié (pièces, réponses oui/non, services autorisés)", "recommande", valide,
              ", ".join([*catalogue.get("types", []), *catalogue.get("predicats", [])]) if valide else (e or "format inattendu"))
        if valide:
            codes = [*catalogue.get("types", []), *catalogue.get("predicats", [])]
            inconnus = [c for c in codes if c not in VOCABULAIRE and c not in (adaptateur or {}).get("types", {})]
            noter("vocabulaire", "Codes de pièces du vocabulaire commun (ou traduits par l'adaptateur)", "recommande", not inconnus,
                  "tous reconnus" if not inconnus else f"inconnus : {', '.join(inconnus)}")
            restreints = [c for c, regle in (catalogue.get("autorisations") or {}).items()
                          if c in catalogue.get("types", []) and "*" not in (regle or [])]
            if restreints:
                u = _url(urls["documents"], {"iu": IU_FICTIF, "types": restreints[0], "demandeur": DEMANDEUR_INCONNU}, adaptateur)
                rr, _, e = await _get(client, u, entetes(service_id, secret, u))
                noter("regles", f"Règle d'accès appliquée : « {restreints[0]} » refusé à un service non autorisé", "recommande",
                      rr is not None and rr.status_code == 403, f"HTTP {rr.status_code}" if rr is not None else e)
            else:
                noter("regles", "Règle d'accès appliquée à un service non autorisé", "recommande", None, "aucune pièce à accès restreint déclarée")
    else:
        noter("catalogue", "Catalogue publié (pièces, réponses oui/non, services autorisés)", "recommande", False, "route /catalogue non fournie")

    # 4. Réponse minimale (oui/non) et vérification d'identité.
    predicats = (catalogue or {}).get("predicats") or []
    if urls.get("predicat") and predicats:
        u = _url(urls["predicat"], {"iu": IU_TEST, "q": predicats[0], "demandeur": "banc-de-conformite"}, adaptateur)
        rp, _, e = await _get(client, u, entetes(service_id, secret, u))
        try:
            corps = rp.json() if rp is not None and rp.status_code == 200 else None
        except Exception:
            corps = None
        ok = isinstance(corps, dict) and corps.get("reponse") in (True, False, None) and set(corps) <= {"q", "reponse"}
        noter("minimisation", f"« {predicats[0]} » répondu par oui/non, sans la donnée source", "recommande", ok,
              json.dumps(corps, ensure_ascii=False)[:120] if corps is not None else (e or f"HTTP {rp.status_code}"))
    if double_api:
        if urls.get("verifier"):
            u = _url(urls["verifier"], {"iu": IU_TEST, "demandeur": "banc-de-conformite"}, adaptateur)
            rv, _, e = await _get(client, u, entetes(service_id, secret, u))
            try:
                corps = rv.json() if rv is not None and rv.status_code == 200 else None
            except Exception:
                corps = None
            noter("verifier", "Vérification d'identité : identifiant de test → {\"valide\": false}", "obligatoire",
                  isinstance(corps, dict) and corps.get("valide") is False, json.dumps(corps, ensure_ascii=False)[:120] if corps is not None else e)
        else:
            noter("verifier", "Vérification d'identité (service en double API)", "obligatoire", False, "route /verifier non fournie")

    obligatoires = [c for c in criteres if c["niveau"] == "obligatoire"]
    return {
        "service": service_id, "le": time.strftime("%Y-%m-%dT%H:%M:%S"), "criteres": criteres,
        "obligatoires": len(obligatoires), "obligatoires_ok": sum(1 for c in obligatoires if c["ok"]),
        "recommandes": sum(1 for c in criteres if c["niveau"] == "recommande" and c["ok"] is not None),
        "recommandes_ok": sum(1 for c in criteres if c["niveau"] == "recommande" and c["ok"]),
        "conforme": all(c["ok"] for c in obligatoires),
    }


async def sante(client: httpx.AsyncClient, services: dict) -> list[dict]:
    """État de chaque registre branché : répond ?, temps de réponse, signature (appel signé avec l'identifiant de test)."""
    async def un(k, v):
        c = v.get("connexion") or {}
        u = _url(c["url_documents"], {"iu": IU_TEST, "demandeur": "supervision"}, v.get("adaptateur"))
        r, ms, err = await _get(client, u, entetes(k, v.get("secret", ""), u))
        ok_sig, detail = _signature(v.get("secret", ""), u, r) if r is not None else (None, err)
        return {"service": k, "nom": v.get("nom", k), "double_api": bool(v.get("double_api")), "branche_le": c.get("branche_le"),
                "repond": r is not None and r.status_code == 200, "http": r.status_code if r is not None else None,
                "temps_ms": round(ms), "signature": {True: "vérifiée", False: "invalide", None: "absente"}[ok_sig] if r is not None else None,
                "detail": detail if r is not None else err, "pieces": len(((v.get("catalogue") or {}).get("types")) or [])}
    actifs = {k: v for k, v in services.items() if v.get("connexion") and v.get("statut") == "actif"}
    return sorted(await asyncio.gather(*(un(k, v) for k, v in actifs.items())), key=lambda x: x["nom"])
