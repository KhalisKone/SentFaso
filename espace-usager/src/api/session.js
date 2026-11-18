/** Connexion : identifiant unique + code à usage unique (SMS ; affiché à l'écran en démonstration). */
import { requete } from "./client.js";

export const demanderCode = (iu) => requete("/session/code", { methode: "POST", corps: { iu } });
export const ouvrirSessionSocle = (iu, code) => requete("/session/ouvrir", { methode: "POST", corps: { iu, code } });
export const moi = () => requete("/session");
