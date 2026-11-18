/** Passerelle d'échange : branchement des registres et échanges avec eux. */
import { requete } from "./client.js";

const qs = (params) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(Array.isArray(v) ? v.join(",") : v)}`)
    .join("&");

// ── Utilisé par le socle ─────────────────────────────────────────────────────
/** Vérifie un identifiant unique auprès du registre d'identité. Réponse minimisée : valide, nom, prénoms. */
export const verifierIu = (iu, demandeur) => requete(`/connect/verifier?${qs({ iu, demandeur })}`);
/** Annuaire public : pour chaque service, branché ou non, catalogue (pièces, réponses minimales) et règles d'accès. */
export const listeBranchements = () => requete("/connect/services");
/** Pièces détenues sur une personne, demandées aux seuls registres et types utiles. Le contexte est transmis au registre et journalisé. */
export const documentsDe = (iu, services, { types, dossier, demandeur, finalite } = {}) =>
  requete(`/connect/documents?${qs({ iu, services, types, dossier, demandeur, finalite })}`);
/** Réponse minimale oui/non (ex. majeur) auprès des registres qui la proposent. */
export const predicatDe = (iu, q, services, { dossier, demandeur, finalite } = {}) =>
  requete(`/connect/predicat?${qs({ iu, q, services, dossier, demandeur, finalite })}`);
/** Lien court vers le fichier d'une pièce, délivré par le registre au moment de la consultation. */
export const lienDocument = (params) => requete(`/connect/lien?${qs(params)}`);
/** Crée le service s'il n'existe pas et génère son code secret (montré une seule fois). */
export const genererSecret = (service) => requete("/connect/services/secret", { methode: "POST", corps: service });
/** Modifie la fiche d'un service (nom, sigle, type, tutelle, ville) : identifiant, code et branchement inchangés. */
/** Supprime un service : code annulé, admins et agents révoqués, démarches retirées (dossiers et journal conservés). */
export const supprimerServiceApi = (id) => requete(`/connect/services/${encodeURIComponent(id)}`, { methode: "DELETE" });
export const modifierFicheService = (id, fiche) => requete(`/connect/services/${encodeURIComponent(id)}/fiche`, { methode: "PUT", corps: fiche });

// ── Utilisé par le service qui vient se brancher ─────────────────────────────
export const ouvrirSession = (ids) => requete("/connect/session", { methode: "POST", corps: ids });
export const testerApi = (ids, { quoi, url, q, adaptateur, iu_essai }) =>
  requete("/connect/tester", { methode: "POST", corps: { ...ids, quoi, url, q, adaptateur, iu_essai } });
export const brancher = (ids, configuration) => requete("/connect/brancher", { methode: "POST", corps: { ...ids, ...configuration } });
export const actualiserCatalogue = (ids) => requete("/connect/catalogue/actualiser", { methode: "POST", corps: ids });

// ── Preuve d'interopérabilité ────────────────────────────────────────────────
/** Banc de conformité passé par le service lui-même, avec son code (avant ou après branchement). */
export const passerBanc = (ids, urls, adaptateur) => requete("/connect/conformite", { methode: "POST", corps: { ...ids, ...urls, adaptateur } });
/** Banc repassé par le super admin sur un registre branché. */
export const passerBancRegistre = (service) => requete(`/connect/conformite/${encodeURIComponent(service)}`, { methode: "POST" });
/** Santé des registres branchés : répond, temps de réponse, signature (super admin). */
export const santeRegistres = () => requete("/connect/sante");
