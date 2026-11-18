/** Journal de traçabilité, tenu par le serveur : lecture, ajout d'une ligne, vérification de la chaîne. */
import { requete } from "./client.js";

export const lireJournal = () => requete("/journal");
/** Le serveur fixe le numéro, l'heure et les empreintes ; il renvoie la ligne scellée. */
export const ajouterLigne = (entree) => requete("/journal", { methode: "POST", corps: entree });
export const verifierJournal = () => requete("/journal/verifier");
/** Démonstration : modification directe d'une ligne en base, comme le ferait un attaquant. */
export const falsifierDemo = () => requete("/journal/demo/falsifier", { methode: "POST", corps: {} });
