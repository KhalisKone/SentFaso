/**
 * Annuaire des registres, publié par la passerelle : ce que chaque registre propose (pièces, réponses minimales)
 * et les services qu'il autorise. Ce sont les registres qui décident ; le guichet ne fait que l'afficher et le respecter.
 */
import { listeBranchements } from "../api/connect.js";
import { estPredicat } from "../noyau/referentiel.js";

/** Registres branchés et actifs : { id: { nom, types, predicats, autorisations, catalogue } }, ou null si la passerelle est injoignable. */
export async function annuaireRegistres(etat) {
  let tous;
  try {
    tous = await listeBranchements();
  } catch {
    return null;
  }
  return Object.fromEntries(
    Object.entries(tous || {}).filter(([id, f]) => f.branche && etat.services[id] && etat.services[id].statut !== "desactive"),
  );
}

/** Règle du registre pour une pièce ou une réponse (par défaut : tous les services). */
export function autorise(fiche, code, demandeur) {
  const regle = fiche.autorisations?.[code] || fiche.autorisations?.["*"] || ["*"];
  return regle.includes("*") || regle.includes(demandeur);
}

/**
 * Registres auxquels demander une pièce ou une réponse :
 *  ids      ceux qui la proposent et autorisent le service demandeur ;
 *  refuses  ceux qui la proposent mais ne l'autorisent pas ;
 *  declare  false si aucun ne l'a déclarée (pour une pièce, on interroge alors les seuls registres sans catalogue).
 */
export function registresPour(annuaire, code, demandeur) {
  const entrees = Object.entries(annuaire || {});
  const proposent = entrees.filter(([, f]) => (estPredicat(code) ? f.predicats : f.types)?.includes(code));
  if (proposent.length) {
    return {
      ids: proposent.filter(([, f]) => autorise(f, code, demandeur)).map(([id]) => id),
      refuses: proposent.filter(([, f]) => !autorise(f, code, demandeur)).map(([id]) => id),
      declare: true,
    };
  }
  const sansCatalogue = estPredicat(code) ? [] : entrees.filter(([, f]) => !f.catalogue).map(([id]) => id);
  return { ids: sansCatalogue, refuses: [], declare: false };
}
