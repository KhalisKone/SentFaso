/** Cycle de vie d'un dossier. */

const FINAUX = ["refuse", "revoque", "clos"];
export const estFinal = (d) => FINAUX.includes(d.statut);

/** Recalcule le statut d'un dossier à partir de ses pièces (mutation en place). */
export function majStatutDossier(d) {
  if (estFinal(d) || d.consent?.statut !== "actif") return;
  const utiles = Object.values(d.pieces || {}).filter((x) => x.statut !== "refusee");
  d.statut = utiles.every((x) => ["fournie", "repondu"].includes(x.statut)) ? "complet" : "autorise";
}

export function avancement(d) {
  const ps = Object.values(d.pieces || {});
  return {
    obtenues: ps.filter((x) => ["fournie", "repondu"].includes(x.statut)).length,
    total: ps.filter((x) => x.statut !== "refusee").length,
  };
}
