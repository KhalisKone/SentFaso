/** Services (administrations) : création, code de branchement, activation. Réservé au super admin. */
import { genererSecret, modifierFicheService, supprimerServiceApi } from "../api/connect.js";
import { socle } from "../donnees/socle.js";
import { identifiantDe, maintenant } from "../noyau/format.js";
import { TYPES_SERVICE } from "../noyau/referentiel.js";
import { auteurDuRole, nomService } from "../noyau/selecteurs.js";

const ficheBranchement = (id, s) => ({
  id, nom: s.nom, sigle: s.sigle, type: s.type, tutelle: s.tutelle ?? null, ville: s.ville, double_api: !!s.double_api,
});

export async function creerService(par, { nom, sigle, type, tutelle, ville, double_api }) {
  nom = nom.trim();
  if (!nom) return { ok: false, msg: "Indiquez le nom du service." };
  const id = identifiantDe(nom);
  if (socle.lire().services[id]) return { ok: false, msg: "Ce service existe déjà." };
  const fiche = { nom, sigle: sigle.trim(), type, tutelle: tutelle || null, ville: ville.trim(), double_api };

  let secret;
  try {
    ({ secret } = await genererSecret(ficheBranchement(id, fiche)));
  } catch {
    return { ok: false, msg: "Le socle est injoignable : service non créé." };
  }
  socle.modifier((d) => void (d.services[id] = { ...fiche, statut: "actif", cree_par: par.code, cree_le: maintenant() }));
  socle.journaliser({
    ...auteurDuRole(par), service: null, action: "Service créé", cible: nom,
    details: [TYPES_SERVICE[type], fiche.tutelle && `tutelle : ${nomService(socle.lire(), fiche.tutelle)}`, fiche.ville].filter(Boolean).join(" — "),
  });
  return { ok: true, id, secret, nom };
}

const LIBELLES_SERVICE = { nom: "nom", sigle: "sigle", type: "type", tutelle: "tutelle", ville: "ville" };

/** Modifie la fiche d'un service. L'identifiant ne change pas (il sert au branchement) : le service reste branché. */
export async function modifierService(par, id, { nom, sigle, type, tutelle, ville }) {
  nom = nom.trim();
  if (!nom) return { ok: false, msg: "Indiquez le nom du service." };
  if (tutelle === id) return { ok: false, msg: "Un service ne peut pas être sa propre tutelle." };
  const avant = socle.lire().services[id];
  const fiche = { nom, sigle: sigle.trim(), type, tutelle: tutelle || null, ville: ville.trim() };
  const changes = Object.keys(LIBELLES_SERVICE).filter((k) => (avant?.[k] ?? "") !== (fiche[k] ?? ""));
  if (!changes.length) return { ok: true, msg: "Aucune modification." };
  try {
    await modifierFicheService(id, fiche);
  } catch (e) {
    return { ok: false, msg: e.message || "Le socle est injoignable : service non modifié." };
  }
  socle.modifier((d) => void Object.assign(d.services[id], fiche, { modifie_par: par.code, modifie_le: maintenant() }));
  const valeur = (k, v) => (!v ? (k === "tutelle" ? "aucune" : "—") : k === "type" ? TYPES_SERVICE[v] || v : k === "tutelle" ? nomService(socle.lire(), v) : v);
  socle.journaliser({
    ...auteurDuRole(par), service: null, action: "Service modifié", cible: nom,
    details: changes.map((k) => `${LIBELLES_SERVICE[k]} : ${valeur(k, avant?.[k])} → ${valeur(k, fiche[k])}`).join(" ; "),
  });
  return { ok: true, msg: `Service « ${nom} » modifié.` };
}

/** Supprime un service (définitif). Le serveur refuse si des dossiers ne sont pas clôturés ou si c'est le seul service d'identité. */
export async function supprimerService(id) {
  await socle.enregistrerMaintenant(); // rien en attente qui pourrait recréer le service
  try {
    const r = await supprimerServiceApi(id);
    await socle.rafraichir();
    return { ok: true, msg: `Service « ${r.nom} » supprimé : ${r.roles} rôle(s) révoqué(s), ${r.demarches} démarche(s) retirée(s).` };
  } catch (e) {
    return { ok: false, msg: e.message || "Le socle est injoignable : service non supprimé." };
  }
}

/** Nouveau code secret : l'ancien ne marche plus et le service doit se rebrancher. */
export async function regenererCode(par, id) {
  let secret;
  try {
    ({ secret } = await genererSecret(ficheBranchement(id, socle.lire().services[id])));
  } catch {
    return { ok: false, msg: "Le socle est injoignable." };
  }
  socle.journaliser({ ...auteurDuRole(par), service: null, action: "Code de branchement généré", cible: nomService(socle.lire(), id) });
  return { ok: true, id, secret, nom: nomService(socle.lire(), id) };
}

export function basculerService(par, id) {
  const actif = socle.modifier((d) => {
    const s = d.services[id];
    s.statut = s.statut === "actif" ? "desactive" : "actif";
    return s.statut === "actif";
  });
  socle.journaliser({ ...auteurDuRole(par), service: null, action: actif ? "Service réactivé" : "Service désactivé", cible: nomService(socle.lire(), id) });
}
