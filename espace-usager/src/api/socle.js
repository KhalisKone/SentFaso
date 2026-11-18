/** État du socle (services, rôles, démarches, dossiers), filtré par le serveur selon les rôles de la personne connectée. */
import { requete } from "./client.js";

export const lireEtat = () => requete("/etat");
/** Le serveur n'applique que les modifications permises à la personne connectée. */
export const ecrireEtat = (etat) => requete("/etat", { methode: "PUT", corps: etat });
