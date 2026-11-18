/** Dates et petits utilitaires d'affichage. */

export const maintenant = () => new Date().toISOString();

export function dateFr(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("fr-FR")} ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}
export const jourFr = (iso) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "—");

export function plusJours(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
}
export function plusMois(iso, n) {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + n);
  return d.toISOString();
}

export const numero = (prefixe, n) => `${prefixe}-${String(n).padStart(4, "0")}`;

/** Identifiant lisible tiré d'un nom (« Mairie de Ouagadougou » → « mairie-de-ouagadougou »). */
export const identifiantDe = (nom) =>
  nom.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
