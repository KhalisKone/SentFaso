"""API de l'assistant (/assistant) : conversation avec Claude Haiku, compétences exécutées côté serveur avec les droits
de la personne connectée, historique des conversations par personne.

Sans connexion, l'assistant répond aux questions générales (aucune compétence, rien n'est enregistré).

Le modèle se choisit dans backend/.env, sans toucher au code :
  ASSISTANT_FOURNISSEUR = aucun | anthropic | compatible-openai
    aucun              : assistant désactivé (la mascotte n'apparaît pas)
    anthropic          : Claude ; clé dans ASSISTANT_CLE (ou ANTHROPIC_API_KEY) ; ASSISTANT_MODELE (défaut claude-haiku-5-5)
    compatible-openai  : tout service au format « chat/completions » avec appels d'outils (Mistral, Ollama, vLLM…) ;
                         ASSISTANT_URL (ex. http://localhost:11434/v1), ASSISTANT_CLE (si le service en demande), ASSISTANT_MODELE
  Sans ASSISTANT_FOURNISSEUR : anthropic si une clé ANTHROPIC_API_KEY est présente, sinon aucun.
"""
import asyncio
import json
import re
import logging
import os
import secrets
import time
from collections import defaultdict, deque

import anthropic
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from assistant import competences
from assistant.consignes import CONNECT, CONSIGNES, contexte
from session import Personne, lire_jeton, personne
from stockage import ref

router = APIRouter(prefix="/assistant", tags=["assistant"])
journal_technique = logging.getLogger("uvicorn.error")

TOURS_MAX = 6                 # appels au modèle par message (compétences comprises)
MESSAGES_PAR_CONVERSATION = 40
QUOTA = {"connecte": (40, 3600), "anonyme": (30, 3600)}  # messages par fenêtre (secondes) ; 30 : dépannage d'un branchement
_client: anthropic.AsyncAnthropic | None = None
_usage: dict = defaultdict(deque)


def fournisseur() -> str:
    choix = os.environ.get("ASSISTANT_FOURNISSEUR", "").strip().lower()
    if choix:
        return choix if choix in ("aucun", "anthropic", "compatible-openai") else "aucun"
    return "anthropic" if os.environ.get("ANTHROPIC_API_KEY") else "aucun"


def modele() -> str:
    return os.environ.get("ASSISTANT_MODELE") or ("claude-haiku-5-5" if fournisseur() == "anthropic" else "")


def verifier_configuration():
    f = fournisseur()
    if f == "aucun":
        raise HTTPException(503, "L'assistant n'est pas activé sur ce serveur.")
    if f == "compatible-openai" and not (os.environ.get("ASSISTANT_URL") and modele()):
        raise HTTPException(503, "L'assistant n'est pas configuré (ASSISTANT_URL et ASSISTANT_MODELE).")


def client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        cle = os.environ.get("ASSISTANT_CLE") or os.environ.get("ANTHROPIC_API_KEY")
        if not cle:
            raise HTTPException(503, "L'assistant n'est pas configuré sur ce serveur.")
        _client = anthropic.AsyncAnthropic(api_key=cle, timeout=60.0, max_retries=2)
    return _client


def limiter(cle: str, genre: str):
    n, fenetre = QUOTA[genre]
    q = _usage[cle]
    while q and q[0] < time.time() - fenetre:
        q.popleft()
    if len(q) >= n:
        raise HTTPException(429, "Vous avez envoyé beaucoup de messages : réessayez dans un moment.")
    q.append(time.time())


def personne_facultative(request: Request) -> Personne | None:
    entete = request.headers.get("Authorization", "")
    iu = lire_jeton(entete[7:]) if entete.startswith("Bearer ") else None
    return Personne(iu) if iu else None


def profil(p: Personne | None) -> dict | None:
    if not p:
        return None
    x = ref(f"socle/personnes/{p.iu}").get() or {}
    return {"nom": f"{x.get('prenoms', '')} {x.get('nom', '')}".strip() or "personne connectée", "roles": p.roles}


CODE_SECRET = re.compile(r"sk_[A-Za-z0-9_\-]{8,}")


def masquer(texte: str) -> str:
    """Un code secret collé par erreur ne part jamais vers le modèle ni dans l'historique."""
    return CODE_SECRET.sub("sk_*** (code secret masqué)", texte or "")


def avec_contexte(message: str, contexte: str | None, page: str | None) -> str:
    """Sur la page de branchement, la configuration saisie (fournie par l'interface, sans code secret) accompagne la question."""
    if not (contexte and sur_connect(page)):
        return masquer(message)
    return (f"[Configuration actuelle de ma page de branchement — fournie automatiquement par l'interface, sans code secret]\n"
            f"{masquer(contexte)}\n\n[Ma question]\n{masquer(message)}")


def sur_connect(page: str | None) -> bool:
    """Page de branchement : l'assistant y ajoute tout le savoir du branchement (contrat, signatures, erreurs, banc)."""
    return "/connect" in (page or "")


async def repondre(p: Personne | None, messages: list, page: str | None) -> tuple[str, list[str], list]:
    """Boucle d'outils : appelle le modèle, exécute les compétences demandées (en parallèle), recommence jusqu'à la réponse.
    Renvoie (texte final, compétences utilisées, nouveaux messages à ajouter à l'historique)."""
    outils = competences.definitions(p)
    systeme = [{"type": "text", "text": CONSIGNES, "cache_control": {"type": "ephemeral"}},
               *([{"type": "text", "text": CONNECT, "cache_control": {"type": "ephemeral"}}] if sur_connect(page) else []),
               {"type": "text", "text": contexte(profil(p), page)}]
    ajoutes, utilisees = [], []
    for _ in range(TOURS_MAX):
        try:
            r = await client().messages.create(
                model=modele(), max_tokens=4000, system=systeme, messages=messages + ajoutes,
                output_config={"effort": "low"}, **({"tools": outils} if outils else {}))
        except anthropic.RateLimitError:
            raise HTTPException(429, "L'assistant est très sollicité : réessayez dans un instant.")
        except anthropic.APIStatusError as e:
            journal_technique.warning("assistant : erreur %s de l'API : %s", e.status_code, e.message)
            raise HTTPException(502, f"L'assistant est momentanément indisponible ({e.status_code}).")
        except anthropic.APIConnectionError:
            raise HTTPException(502, "L'assistant est injoignable.")
        # Les blocs (réflexion comprise) sont renvoyés tels quels au tour suivant.
        ajoutes.append({"role": "assistant", "content": [b.to_dict() for b in r.content]})
        appels = [b for b in r.content if b.type == "tool_use"]
        if r.stop_reason == "tool_use" and appels:
            resultats = await asyncio.gather(*(competences.executer(p, b.name, b.input) for b in appels))
            utilisees += [b.name for b in appels]
            ajoutes.append({"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": b.id, "content": res, **({"is_error": True} if err else {})}
                for b, (res, err) in zip(appels, resultats)]})
            continue
        texte = "\n\n".join(b.text for b in r.content if b.type == "text").strip()
        if r.stop_reason == "refusal":
            texte = "Je ne peux pas répondre à cette demande. Je peux en revanche vous aider sur vos démarches et le fonctionnement du socle."
        elif r.stop_reason == "max_tokens":
            texte += "\n\n(Réponse tronquée : posez une question plus précise.)"
        return texte or "Je n'ai pas de réponse à proposer.", utilisees, ajoutes
    return "Je n'ai pas pu terminer cette vérification : reformulez votre demande, plus simplement.", utilisees, ajoutes


def client_http() -> httpx.AsyncClient:
    """Client des appels au fournisseur compatible OpenAI (remplacé dans les tests)."""
    return httpx.AsyncClient(timeout=90)


async def repondre_compatible_openai(p: Personne | None, messages: list, page: str | None) -> tuple[str, list[str]]:
    """Même boucle d'outils, au format « chat/completions » (Mistral, Ollama, vLLM…). messages : [{role, content}] en texte."""
    url = os.environ["ASSISTANT_URL"].rstrip("/") + "/chat/completions"
    cle = os.environ.get("ASSISTANT_CLE")
    outils = [{"type": "function", "function": {"name": d["name"], "description": d["description"], "parameters": d["input_schema"]}}
              for d in competences.definitions(p)]
    fil = [{"role": "system", "content": CONSIGNES + ("\n\n" + CONNECT if sur_connect(page) else "") + "\n\n" + contexte(profil(p), page)}, *messages]
    utilisees = []
    async with client_http() as http:
        for _ in range(TOURS_MAX):
            corps = {"model": modele(), "messages": fil, "max_tokens": 1500, **({"tools": outils} if outils else {})}
            try:
                r = await http.post(url, json=corps, headers={"Authorization": f"Bearer {cle}"} if cle else {})
            except httpx.HTTPError:
                raise HTTPException(502, "L'assistant est injoignable.")
            if r.status_code == 429:
                raise HTTPException(429, "L'assistant est très sollicité : réessayez dans un instant.")
            if r.status_code >= 400:
                journal_technique.warning("assistant : erreur %s du fournisseur : %s", r.status_code, r.text[:300])
                raise HTTPException(502, f"L'assistant est momentanément indisponible ({r.status_code}).")
            choix = (r.json().get("choices") or [{}])[0]
            message = choix.get("message") or {}
            appels = message.get("tool_calls") or []
            if appels:
                fil.append({"role": "assistant", "content": message.get("content") or "", "tool_calls": appels})
                async def un(a):
                    try:
                        entree = json.loads(a["function"].get("arguments") or "{}")
                    except ValueError:
                        return '{"erreur": "paramètres illisibles"}', True
                    return await competences.executer(p, a["function"]["name"], entree)
                resultats = await asyncio.gather(*(un(a) for a in appels))
                utilisees += [a["function"]["name"] for a in appels]
                fil += [{"role": "tool", "tool_call_id": a["id"], "content": res} for a, (res, _) in zip(appels, resultats)]
                continue
            texte = (message.get("content") or "").strip()
            if choix.get("finish_reason") == "length":
                texte += "\n\n(Réponse tronquée : posez une question plus précise.)"
            return texte or "Je n'ai pas de réponse à proposer.", utilisees
    return "Je n'ai pas pu terminer cette vérification : reformulez votre demande, plus simplement.", utilisees


# ── Historique ───────────────────────────────────────────────────────────────
def reparer(messages: list) -> list:
    """La base supprime les valeurs vides : on rétablit les champs obligatoires des blocs avant de les renvoyer à l'API
    (ex. l'entrée vide {} d'une compétence sans paramètre)."""
    obligatoires = {"tool_use": ("input", {}), "text": ("text", ""), "thinking": ("thinking", ""), "tool_result": ("content", "")}
    for m in messages:
        if isinstance(m.get("content"), list):
            for bloc in m["content"]:
                champ = obligatoires.get(bloc.get("type"))
                if champ and bloc.get(champ[0]) is None:
                    bloc[champ[0]] = champ[1]
    return messages


def chemin(iu: str, cid: str) -> str:
    return f"assistant/conversations/{iu}/{cid}"


def lister(iu: str) -> list[dict]:
    index = ref(f"assistant/index/{iu}").get() or {}
    return sorted(({"id": k, **v} for k, v in index.items()), key=lambda c: c.get("maj", ""), reverse=True)


# ── Routes ───────────────────────────────────────────────────────────────────
class Message(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    conversation: str | None = Field(None, description="Identifiant d'une conversation existante (sinon : nouvelle).")
    page: str | None = Field(None, description="Page où se trouve la personne, pour adapter la réponse.")
    contexte: str | None = Field(None, max_length=3000, description="Page de branchement : configuration saisie (sans code secret).")


class MessagePublic(BaseModel):
    message: str = Field(min_length=1, max_length=4000, description="Question, ou message d'erreur collé (4000 caractères au plus).")
    historique: list[dict] = Field(default_factory=list, description="Derniers échanges [{role, texte}] (10 au plus).")
    page: str | None = None
    contexte: str | None = Field(None, max_length=3000, description="Page de branchement : configuration saisie (sans code secret).")


@router.get("/etat", summary="L'assistant est-il activé sur ce serveur ?")
def etat():
    f = fournisseur()
    return {"actif": f != "aucun", "fournisseur": f, "modele": modele() if f != "aucun" else None}


@router.get("/competences", summary="Compétences de l'assistant ouvertes à la personne connectée")
def lister_competences(request: Request):
    p = personne_facultative(request)
    return [{"nom": nom, "libelle": c[1], "description": c[3]} for nom, c in competences.disponibles(p).items()]


@router.get("/conversations", summary="Historique : conversations de la personne connectée")
def conversations(p: Personne = Depends(personne)):
    return lister(p.iu)


@router.get("/conversations/{cid}", summary="Fil d'une conversation")
def conversation(cid: str, p: Personne = Depends(personne)):
    c = ref(chemin(p.iu, cid)).get()
    if not c:
        raise HTTPException(404, "Conversation introuvable.")
    return {"id": cid, "titre": c.get("titre"), "fil": c.get("fil", [])}


@router.delete("/conversations/{cid}", summary="Supprimer une conversation")
def supprimer(cid: str, p: Personne = Depends(personne)):
    ref(chemin(p.iu, cid)).delete()
    ref(f"assistant/index/{p.iu}/{cid}").delete()
    return {"ok": True}


@router.post("/message", summary="Envoyer un message (personne connectée) ; la conversation est enregistrée")
async def message(m: Message, p: Personne = Depends(personne)):
    limiter(p.iu, "connecte")
    cid = m.conversation or f"C{int(time.time() * 1000)}{secrets.token_hex(2)}"
    c = (ref(chemin(p.iu, cid)).get() if m.conversation else None) or {"titre": m.message[:70], "api": [], "fil": [], "cree": time.time()}
    if len(c.get("fil", [])) >= MESSAGES_PAR_CONVERSATION * 2:
        raise HTTPException(409, "Cette conversation est longue : commencez-en une nouvelle.")
    verifier_configuration()
    question = {"role": "user", "content": avec_contexte(m.message, m.contexte, m.page)}
    if fournisseur() == "compatible-openai":  # historique repris en texte (le format détaillé est propre à chaque fournisseur)
        passe = [{"role": "user" if x["role"] == "user" else "assistant", "content": x["texte"]} for x in c.get("fil", [])[-20:]]
        texte, utilisees = await repondre_compatible_openai(p, [*passe, question], m.page)
        ajoutes = []
    else:
        texte, utilisees, ajoutes = await repondre(p, [*reparer(c.get("api", [])), question], m.page)
    maintenant = time.strftime("%Y-%m-%dT%H:%M:%S")
    if ajoutes:  # détail propre à Claude (réflexion, appels d'outils), rejoué tel quel au tour suivant
        c["api"] = [*c.get("api", []), question, *ajoutes]
    c["fil"] = [*c.get("fil", []), {"role": "user", "texte": masquer(m.message), "le": maintenant},
                {"role": "assistant", "texte": texte, "le": maintenant, "competences": [competences.libelle(n) for n in dict.fromkeys(utilisees)]}]
    c["maj"] = maintenant
    ref(chemin(p.iu, cid)).set(c)
    ref(f"assistant/index/{p.iu}/{cid}").set({"titre": c["titre"], "maj": maintenant, "messages": len(c["fil"])})
    return {"conversation": cid, "titre": c["titre"], "reponse": c["fil"][-1]}


@router.post("/public", summary="Question générale sans connexion (aucune compétence, rien n'est enregistré)")
async def public(m: MessagePublic, request: Request):
    limiter(f"ip:{request.client.host if request.client else '?'}", "anonyme")
    passe = [{"role": "user" if x.get("role") == "user" else "assistant", "content": masquer(str(x.get("texte", ""))[:4000])}
             for x in m.historique[-10:] if x.get("texte")]
    while passe and passe[0]["role"] != "user":
        passe.pop(0)
    verifier_configuration()
    question = {"role": "user", "content": avec_contexte(m.message, m.contexte, m.page)}
    if fournisseur() == "compatible-openai":
        texte, _ = await repondre_compatible_openai(None, [*passe, question], m.page)
    else:
        texte, _, _ = await repondre(None, [*passe, question], m.page)
    return {"reponse": {"role": "assistant", "texte": texte, "competences": []}}
