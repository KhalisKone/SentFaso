/**
 * Assistant présent sur toutes les pages : la mascotte (cheval blanc au foulard du Faso) ouvre un panneau de discussion.
 * Connecté : conversations enregistrées (historique), compétences selon le rôle (vérifications exécutées par le serveur
 * avec les droits de la personne). Sans connexion : questions générales, rien n'est enregistré.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  competencesAssistant, conversationAssistant, conversationsAssistant, envoyerMessage, envoyerMessagePublic, etatAssistant, supprimerConversation,
} from "../api/assistant.js";
import mascotte from "../assets/mascotte-128.png";
import mascotteGrande from "../assets/mascotte-320.png";
import { useSession } from "../donnees/hooks.js";
import { cls } from "../ui/cls.js";
import { BarreRecherche, useRecherche } from "../ui/Recherche.jsx";

const CLE = "dlnuf-assistant";
const lireMemoire = () => {
  try {
    return JSON.parse(sessionStorage.getItem(CLE)) || {};
  } catch {
    return {};
  }
};
const ecrireMemoire = (v) => {
  try {
    sessionStorage.setItem(CLE, JSON.stringify(v));
  } catch {
    /* sans stockage : l'état reste en mémoire */
  }
};

/** Mise en forme légère et sûre : le texte est échappé, puis **gras**, `code`, listes et paragraphes. */
function Texte({ texte }) {
  const lignes = String(texte || "").split("\n");
  const blocs = [];
  let liste = null;
  const enLigne = (s, k) =>
    s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((morceau, i) =>
      morceau.startsWith("**") && morceau.endsWith("**") ? <b key={`${k}-${i}`}>{morceau.slice(2, -2)}</b>
      : morceau.startsWith("`") && morceau.endsWith("`") ? <code key={`${k}-${i}`}>{morceau.slice(1, -1)}</code>
      : <Fragment key={`${k}-${i}`}>{morceau}</Fragment>);
  lignes.forEach((l, i) => {
    const puce = l.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (puce) {
      liste = liste || [];
      liste.push(<li key={i}>{enLigne(puce[1], i)}</li>);
      return;
    }
    if (liste) {
      blocs.push(<ul key={`u${i}`}>{liste}</ul>);
      liste = null;
    }
    if (l.trim()) blocs.push(<p key={i}>{enLigne(l.replace(/^#+\s*/, ""), i)}</p>);
  });
  if (liste) blocs.push(<ul key="fin">{liste}</ul>);
  return <div className="as-texte">{blocs}</div>;
}

/** Suggestions selon la page et les compétences ouvertes à la personne. */
function suggestions(page, competences) {
  const a = (nom) => competences.some((c) => c.nom === nom);
  if (!competences.length) return ["Comment fonctionne le socle ?", "Que dois-je donner au guichet ?", "Comment me connecter ?"];
  if (page.includes("/agent") && a("verifier_une_identite"))
    return ["Mes dossiers en attente de l'accord du citoyen", "D'où viennent les pièces de mes démarches ?", "Vérifie le NIN 99000000000000036"];
  if (page.includes("/admin") && a("agents_du_service")) return ["Quelles démarches propose mon service ?", "Liste les agents de mon service"];
  if (page.includes("/super-admin") && a("tester_les_registres")) return ["Les registres répondent-ils ?", "Le journal est-il intègre ?", "Quels services sont branchés ?"];
  return ["Où en sont mes demandes ?", "Qui a consulté mes données ?", "Quels papiers dois-je encore fournir ?"];
}

const ACCUEIL = {
  role: "assistant",
  texte: "Bonjour ! Je suis l'assistant du socle « Dites-le-nous une fois ». Posez-moi vos questions sur vos démarches, ou demandez-moi une vérification.",
  competences: [],
};

export function Assistant() {
  const page = useLocation().pathname;
  const session = useSession();
  const memoire = useMemo(lireMemoire, []);
  const [ouvert, setOuvert] = useState(Boolean(memoire.ouvert));
  const [vue, setVue] = useState("discussion"); // discussion | historique
  const [conversation, setConversation] = useState(session ? memoire.conversation || null : null);
  const [fil, setFil] = useState([]);
  const [historique, setHistorique] = useState([]);
  const [competences, setCompetences] = useState([]);
  const [saisie, setSaisie] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState(null);
  const bas = useRef(null);
  const rechercheConv = useRecherche(historique, (c) => [c.titre, c.maj && new Date(c.maj).toLocaleDateString("fr-FR")]);
  const champ = useRef(null);
  const connecte = Boolean(session);
  const [actif, setActif] = useState(null); // assistant activé sur ce serveur ?

  useEffect(() => {
    etatAssistant().then((e) => setActif(Boolean(e.actif)), () => setActif(false));
  }, []);

  useEffect(() => ecrireMemoire({ ouvert, conversation }), [ouvert, conversation]);

  // Changement de personne : compétences et conversation de la nouvelle session.
  useEffect(() => {
    competencesAssistant().then(setCompetences, () => setCompetences([]));
    if (!connecte) {
      setConversation(null);
      setFil([]);
      setHistorique([]);
    }
  }, [connecte, session?.iu]);

  // Reprise de la conversation en cours à l'ouverture.
  useEffect(() => {
    if (!ouvert || !connecte || !conversation || fil.length) return;
    conversationAssistant(conversation).then((c) => setFil(c.fil || []), () => setConversation(null));
  }, [ouvert, connecte, conversation]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bas.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [fil, enCours]);
  useEffect(() => {
    if (ouvert && vue === "discussion") setTimeout(() => champ.current?.focus(), 150);
  }, [ouvert, vue]);

  const envoyer = async (texte) => {
    const message = (texte ?? saisie).trim();
    if (!message || enCours) return;
    setSaisie("");
    setErreur(null);
    const precedent = fil;
    setFil([...fil, { role: "user", texte: message }]);
    setEnCours(true);
    try {
      if (connecte) {
        const r = await envoyerMessage(message, conversation, page);
        setConversation(r.conversation);
        setFil((f) => [...f, r.reponse]);
      } else {
        const r = await envoyerMessagePublic(message, precedent.slice(-10), page);
        setFil((f) => [...f, r.reponse]);
      }
    } catch (e) {
      setErreur(e.message);
      setFil(precedent);
      setSaisie(message);
    }
    setEnCours(false);
  };

  const nouvelle = () => {
    setConversation(null);
    setFil([]);
    setVue("discussion");
    setErreur(null);
  };
  const ouvrirHistorique = async () => {
    setVue("historique");
    try {
      setHistorique(await conversationsAssistant());
    } catch (e) {
      setErreur(e.message);
    }
  };
  const reprendre = async (id) => {
    try {
      const c = await conversationAssistant(id);
      setConversation(id);
      setFil(c.fil || []);
      setVue("discussion");
    } catch (e) {
      setErreur(e.message);
    }
  };
  const effacer = async (id) => {
    await supprimerConversation(id).catch(() => {});
    setHistorique((h) => h.filter((c) => c.id !== id));
    if (id === conversation) nouvelle();
  };

  if (!actif) return null; // désactivé (ou pas encore connu) : pas de mascotte
  const messages = [ACCUEIL, ...fil];
  return (
    <>
      <button type="button" className={cls("as-bouton", ouvert && "ouvert")} onClick={() => setOuvert(!ouvert)}
        aria-label={ouvert ? "Fermer l'assistant" : "Ouvrir l'assistant"} title="Votre assistant">
        <img src={mascotte} alt="" />
        {!ouvert ? <span className="as-bulle-appel">Une question ?</span> : null}
      </button>

      {ouvert ? (
        <section className="as-panneau" aria-label="Assistant">
          <header className="as-entete">
            <img src={mascotteGrande} alt="Mascotte du socle : cheval blanc au foulard du Burkina Faso" />
            <div>
              <b>Votre assistant</b>
              <small>{connecte ? `${competences.length} compétence(s) pour vous` : "Connectez-vous pour vos données"}</small>
            </div>
            <nav>
              {connecte ? (
                <>
                  <button type="button" onClick={nouvelle} title="Nouvelle conversation" aria-label="Nouvelle conversation">＋</button>
                  <button type="button" onClick={vue === "historique" ? () => setVue("discussion") : ouvrirHistorique}
                    title="Historique" aria-label="Historique" className={cls(vue === "historique" && "actif")}>🕘</button>
                </>
              ) : null}
              <button type="button" onClick={() => setOuvert(false)} title="Fermer" aria-label="Fermer">✕</button>
            </nav>
          </header>

          {vue === "historique" ? (
            <div className="as-historique">
              <h3>Vos conversations</h3>
              {historique.length > 1 ? <BarreRecherche recherche={rechercheConv} total={historique.length} placeholder="Rechercher une conversation…" /> : null}
              {historique.length ? (
                rechercheConv.resultats.map((c) => (
                  <div key={c.id} className={cls("as-conv", c.id === conversation && "actif")}>
                    <button type="button" onClick={() => reprendre(c.id)}>
                      <b>{c.titre}</b>
                      <small>
                        {new Date(c.maj).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })} · {Math.floor((c.messages || 0) / 2)} échange(s)
                      </small>
                    </button>
                    <button type="button" className="as-suppr" onClick={() => effacer(c.id)} aria-label="Supprimer" title="Supprimer">🗑</button>
                  </div>
                ))
              ) : (
                <p className="vide">Aucune conversation pour l'instant.</p>
              )}
              {historique.length && !rechercheConv.resultats.length ? <p className="vide">Aucun résultat pour « {rechercheConv.requete} ».</p> : null}
            </div>
          ) : (
            <div className="as-fil">
              {messages.map((m, i) => (
                <div key={i} className={cls("as-message", m.role === "user" ? "moi" : "lui")}>
                  {m.role !== "user" ? <img src={mascotte} alt="" className="as-avatar" /> : null}
                  <div className="as-contenu">
                    {m.role === "user" ? <p>{m.texte}</p> : <Texte texte={m.texte} />}
                    {m.competences?.length ? (
                      <div className="as-competences">
                        {m.competences.map((c) => (
                          <span key={c}>{c}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              {enCours ? (
                <div className="as-message lui">
                  <img src={mascotte} alt="" className="as-avatar saute" />
                  <div className="as-contenu as-ecrit">
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
              ) : null}
              {!fil.length && !enCours ? (
                <div className="as-suggestions">
                  {suggestions(page, competences).map((s) => (
                    <button key={s} type="button" onClick={() => envoyer(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              ) : null}
              <div ref={bas} />
            </div>
          )}

          {erreur ? <div className="as-erreur">{erreur}</div> : null}
          {vue === "discussion" ? (
            <form className="as-saisie" onSubmit={(e) => { e.preventDefault(); envoyer(); }}>
              <textarea ref={champ} rows={1} value={saisie} maxLength={2000} placeholder="Écrivez votre question…" aria-label="Votre question"
                onChange={(e) => setSaisie(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    envoyer();
                  }
                }} />
              <button type="submit" disabled={!saisie.trim() || enCours} aria-label="Envoyer">➤</button>
            </form>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
