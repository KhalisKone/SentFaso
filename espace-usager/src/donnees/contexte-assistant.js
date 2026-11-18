/** Contexte qu'une page fournit à l'assistant (ex. la page de branchement : configuration saisie, sans code secret). */
let texte = null;
export const definirContexteAssistant = (t) => {
  texte = t || null;
};
export const contexteAssistant = () => texte;
