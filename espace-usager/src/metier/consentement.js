/**
 * Accord d'un dossier, tenu par la couche consentement du serveur : créé à l'ouverture (service, finalité, pièces, durée),
 * contrôlé avant chaque échange, clôturé par l'agent. Le citoyen n'a rien à faire : il voit chaque échange dans son journal.
 */
import { socle } from "../donnees/socle.js";
import { majStatutDossier } from "../noyau/dossiers.js";
import { TYPES_PIECE } from "../noyau/referentiel.js";
import { transmise } from "./recherche.js";

/** Forme de l'accord gardée sur le dossier pour l'affichage. */
export const vueAccord = (a) => ({ statut: a.statut, requis: !!a.requis, autorisees: a.pieces || [], le: a.le, expire: a.expire });

/** Plusieurs registres détiennent la pièce : le citoyen choisit celle qui est jointe au dossier. */
export function choisirPiece(iu, dossierId, type, index) {
  const d = socle.lire().dossiers[dossierId];
  const c = d?.pieces?.[type]?.candidats?.[index];
  if (!c || d.iu !== iu || d.pieces[type].statut !== "a_choisir") return;
  socle.modifier((e) => {
    Object.assign(e.dossiers[dossierId].pieces[type], transmise(c));
    majStatutDossier(e.dossiers[dossierId]);
  });
  socle.journaliser({ casquette: "citoyen", iu, service: d.service, action: "Pièce choisie", cible: `${dossierId} / ${TYPES_PIECE[type]}`, details: `${c.titre} — ${c.nomService}` });
}
