/** Identité : vérification de l'identifiant unique auprès du registre d'identité. */
import { verifierIu } from "../api/connect.js";
import { socle } from "../donnees/socle.js";
import { IU_VALIDE } from "../noyau/identite.js";

export class RegistreInjoignable extends Error {
  constructor() {
    super("Vérification impossible : le registre d'identité est injoignable.");
  }
}

/**
 * Renvoie la personne (nom, prénoms, date de naissance) si l'identifiant existe au registre, sinon null.
 * Lève RegistreInjoignable si le registre ne répond pas. `demandeur` (service ou « portail ») est inscrit au journal.
 */
export async function verifierIdentite(iu, demandeur) {
  if (!IU_VALIDE.test(iu)) return null;
  const connue = socle.lire().personnes[iu];
  if (connue) return connue;
  let r;
  try {
    r = await verifierIu(iu, demandeur);
  } catch (e) {
    if (e.statut === 403) throw new Error(e.message);
    throw new RegistreInjoignable();
  }
  if (!r?.valide) return null;
  // Minimisation : le socle ne garde que de quoi vérifier la personne en face (pas de date de naissance).
  const personne = { nom: r.nom, prenoms: r.prenoms };
  socle.modifier((d) => void (d.personnes[iu] = personne));
  return personne;
}
