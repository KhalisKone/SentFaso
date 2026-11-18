/** Couche consentement : accord de chaque dossier, créé et clôturé par l'agent, contrôlé par la passerelle. */
import { requete } from "./client.js";

/** L'agent ouvre l'accord du dossier : actif dès l'ouverture. */
export const creerAccord = (accord) => requete("/consentement/accords", { methode: "POST", corps: accord });
/** Lire l'accord d'un dossier ; une tentative hors de son service est refusée et journalisée par le serveur. */
export const lireAccord = (dossier) => requete(`/consentement/accords/${encodeURIComponent(dossier)}`);
/** action : clore (agent). */
export const decider = (dossier, action) => requete(`/consentement/accords/${dossier}/${action}`, { methode: "POST", corps: {} });
