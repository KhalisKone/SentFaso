/** Assistant (Claude Haiku) : conversations enregistrées pour la personne connectée, questions générales sans connexion. */
import { requete } from "./client.js";

/** L'assistant est-il activé sur ce serveur (ASSISTANT_FOURNISSEUR) ? */
export const etatAssistant = () => requete("/assistant/etat");
export const competencesAssistant = () => requete("/assistant/competences");
export const conversationsAssistant = () => requete("/assistant/conversations");
export const conversationAssistant = (id) => requete(`/assistant/conversations/${encodeURIComponent(id)}`);
export const supprimerConversation = (id) => requete(`/assistant/conversations/${encodeURIComponent(id)}`, { methode: "DELETE" });
export const envoyerMessage = (message, conversation, page, contexte) =>
  requete("/assistant/message", { methode: "POST", corps: { message, conversation, page, contexte } });
export const envoyerMessagePublic = (message, historique, page, contexte) =>
  requete("/assistant/public", { methode: "POST", corps: { message, historique, page, contexte } });
