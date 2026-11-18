/** Lectures de l'état du socle (fonctions pures). */

export const rolesActifs = (etat, role) => etat.roles.filter((r) => r.role === role && r.statut === "actif");

/** Rôle actif d'une personne pour un acteur donné (null pour le citoyen ou sans rôle). */
export const roleDe = (etat, iu, acteur) => (acteur === "citoyen" ? null : rolesActifs(etat, acteur).find((r) => r.iu === iu) || null);

/** Rôles actifs d'une personne, sans doublon (« agent », « admin »…). */
export const rolesDe = (etat, iu) => [...new Set(etat.roles.filter((r) => r.iu === iu && r.statut === "actif").map((r) => r.role))];

export function nomDe(etat, iu) {
  const p = etat.personnes?.[iu];
  if (p) return `${p.prenoms} ${p.nom}`;
  return etat.roles.find((r) => r.iu === iu && r.nom)?.nom || "Inconnu";
}
export const nomService = (etat, id) => etat.services?.[id]?.nom || id || "";

export const dossiersDe = (etat, iu) =>
  Object.values(etat.dossiers).filter((d) => d.iu === iu).sort((a, b) => b.cree.localeCompare(a.cree));
export const dossiersDuService = (etat, service) =>
  Object.values(etat.dossiers).filter((d) => d.service === service).sort((a, b) => b.cree.localeCompare(a.cree));
export const piecesDe = (d) => Object.entries(d.pieces || {});
export const consentementActif = (d) => d.consent?.statut === "actif";

/** Auteur à inscrire au journal pour une action faite sous un rôle. */
export const auteurDuRole = (r) => ({ auteur: r?.iu, code: r?.code, casquette: r?.role, service: r?.service ?? null });

/** Paramètre du citoyen : demander son accord avant tout échange (désactivé par défaut). */
export const enAttenteAccord = (d) => d.consent?.statut === "en_attente";
