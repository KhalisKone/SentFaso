/** Démarches d'un service : finalité, base légale, pièces demandées, durée de l'accord. Réservé à l'admin du service. */
import { socle } from "../donnees/socle.js";
import { maintenant } from "../noyau/format.js";
import { TYPES_PIECE } from "../noyau/referentiel.js";
import { auteurDuRole } from "../noyau/selecteurs.js";

export function creerDemarche(par, { nom, finalite, base_legale, pieces, duree }) {
  nom = nom.trim();
  finalite = finalite.trim();
  base_legale = base_legale.trim();
  if (!nom || !finalite || !pieces.length) return { ok: false, msg: "Indiquez le nom, la finalité et au moins une pièce." };
  socle.modifier((d) => {
    const liste = (d.demarches[par.service] ||= {});
    const id = `DM-${String(Object.keys(liste).length + 1).padStart(3, "0")}`;
    liste[id] = { nom, finalite, base_legale, pieces, duree: Number(duree) || 30, statut: "active", cree_par: par.code, cree_le: maintenant() };
  });
  socle.journaliser({ ...auteurDuRole(par), action: "Démarche créée", cible: nom, details: pieces.map((t) => TYPES_PIECE[t]).join(", ") });
  return { ok: true, msg: `Démarche « ${nom} » créée. Les agents peuvent l'utiliser.` };
}

export function basculerDemarche(par, id) {
  const { nom, active } = socle.modifier((d) => {
    const dm = d.demarches[par.service][id];
    dm.statut = dm.statut === "active" ? "desactivee" : "active";
    return { nom: dm.nom, active: dm.statut === "active" };
  });
  socle.journaliser({ ...auteurDuRole(par), action: active ? "Démarche réactivée" : "Démarche désactivée", cible: nom });
}

/**
 * Modifie une démarche (nom, finalité, base légale, pièces, durée). Les dossiers déjà ouverts gardent leurs pièces :
 * la modification vaut pour les prochains dossiers.
 */
export function modifierDemarche(par, id, { nom, finalite, base_legale, pieces, duree }) {
  nom = nom.trim();
  finalite = finalite.trim();
  base_legale = (base_legale || "").trim();
  duree = Number(duree) || 30;
  if (!nom || !finalite || !pieces.length) return { ok: false, msg: "Indiquez le nom, la finalité et au moins une pièce." };
  const avant = socle.lire().demarches[par.service]?.[id];
  if (!avant) return { ok: false, msg: "Démarche introuvable." };
  const changes = [];
  if (avant.nom !== nom) changes.push(`nom : ${avant.nom} → ${nom}`);
  if (avant.finalite !== finalite) changes.push("finalité modifiée");
  if ((avant.base_legale || "") !== base_legale) changes.push(base_legale ? `base légale : ${base_legale}` : "base légale retirée");
  const ajoutees = pieces.filter((t) => !avant.pieces.includes(t)), retirees = avant.pieces.filter((t) => !pieces.includes(t));
  if (ajoutees.length) changes.push(`pièces ajoutées : ${ajoutees.map((t) => TYPES_PIECE[t]).join(", ")}`);
  if (retirees.length) changes.push(`pièces retirées : ${retirees.map((t) => TYPES_PIECE[t]).join(", ")}`);
  if ((avant.duree || 30) !== duree) changes.push(`durée : ${avant.duree || 30} → ${duree} jours`);
  if (!changes.length) return { ok: true, msg: "Aucune modification." };
  socle.modifier((d) => void Object.assign(d.demarches[par.service][id], { nom, finalite, base_legale, pieces, duree, modifie_par: par.code, modifie_le: maintenant() }));
  socle.journaliser({ ...auteurDuRole(par), action: "Démarche modifiée", cible: nom, details: changes.join(" ; ") });
  return { ok: true, msg: `Démarche « ${nom} » modifiée. Les dossiers déjà ouverts ne changent pas.` };
}
