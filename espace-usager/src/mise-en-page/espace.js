import { createContext, useContext } from "react";

/** Contexte d'un espace : acteur, identifiant unique de la personne connectée, rôle utilisé. */
export const ContexteEspace = createContext(null);
export const useEspace = () => useContext(ContexteEspace);
