/** Accès React aux stores. */
import { useSyncExternalStore } from "react";
import { reseau } from "./reseau.js";
import { session } from "./session.js";
import { socle } from "./socle.js";

export const useSocle = () => useSyncExternalStore(socle.abonner, socle.lire);
export const useStatutSocle = () => useSyncExternalStore(socle.abonner, socle.statut);
export const useSession = () => useSyncExternalStore(session.abonner, session.lire);
export const useReseau = () => useSyncExternalStore(reseau.abonner, reseau.lire);
