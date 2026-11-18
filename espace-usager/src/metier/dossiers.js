/**
 * Dossiers au guichet : contrôles de la passerelle, ouverture, consultation des pièces, clôture.
 * L'agent ne lit jamais librement les registres : il ne voit que ce que la passerelle a transmis pour son dossier.
 */
import { lienDocument } from "../api/connect.js";
import { creerAccord, decider, lireAccord } from "../api/consentement.js";
import { coffre } from "../donnees/fichiers.js";
import { socle } from "../donnees/socle.js";
import { estFinal, majStatutDossier } from "../noyau/dossiers.js";
import { maintenant, numero, plusJours } from "../noyau/format.js";
import { TYPES_PIECE } from "../noyau/referentiel.js";
import { auteurDuRole, consentementActif, nomService } from "../noyau/selecteurs.js";
import { vueAccord } from "./consentement.js";
import { verifierIdentite } from "./identite.js";
import { rechercherPieces } from "./recherche.js";

export const estExpire = (d) => Boolean(d.expire) && new Date(d.expire) < new Date();

/** Contrôles faits par la passerelle avant d'ouvrir un dossier : habilitation, service, démarche, finalité (base légale affichée si renseignée). */
export function controlesOuverture(etat, role, demarche) {
  const habilite = etat.roles.some((r) => r.iu === role.iu && r.role === "agent" && r.statut === "actif" && r.service === role.service);
  return [
    { id: "habilitation", libelle: `Agent ${role.code} habilité pour ${nomService(etat, role.service)}`, ok: habilite },
    { id: "service", libelle: "Service actif", ok: etat.services[role.service]?.statut !== "desactive" },
    { id: "demarche", libelle: "Démarche active", ok: demarche?.statut === "active" },
    { id: "finalite", libelle: demarche?.finalite ? `Finalité : ${demarche.finalite}` : "Finalité déclarée", ok: Boolean(demarche?.finalite) },
    ...(demarche?.base_legale ? [{ id: "base_legale", libelle: `Base légale : ${demarche.base_legale}`, ok: true }] : []),
  ];
}

/**
 * Ouvre un dossier : un numéro est réservé, la couche consentement crée l'accord (actif d'emblée, ou en attente si le
 * citoyen a demandé à donner son accord), puis le dossier est créé et, si l'accord est actif, les registres sont interrogés.
 */
export async function creerDossier(role, iu, demarcheId) {
  const etat = socle.lire();
  const demarche = etat.demarches[role.service]?.[demarcheId];
  if (!demarche) return { ok: false, msg: "Choisissez une démarche." };
  const refus = controlesOuverture(etat, role, demarche).filter((c) => !c.ok);
  if (refus.length) return { ok: false, msg: `Ouverture refusée par la passerelle : ${refus.map((c) => c.libelle.toLowerCase()).join(", ")} manquante(s).` };

  const personne = await verifierIdentite(iu, role.service);
  if (!personne) return { ok: false, msg: "Identifiant unique inconnu." };
  if (iu === role.iu) {
    socle.journaliser({ ...auteurDuRole(role), action: "Dossier refusé (conflit d'intérêts)", iu, resultat: "refusé" });
    return { ok: false, msg: "Conflit d'intérêts : un agent ne peut pas traiter un dossier qui le concerne. Tentative journalisée." };
  }

  // Numéro réservé puis accord : si un autre poste a pris le même numéro au même moment, on prend le suivant.
  let id, accord;
  for (let essai = 0; essai < 5 && !accord; essai++) {
    id = socle.modifier((e) => numero("D", (e.seq.dossier = (e.seq.dossier || 0) + 1)));
    try {
      accord = await creerAccord({ dossier: id, iu, service: role.service, finalite: demarche.finalite, base_legale: demarche.base_legale,
                                   pieces: demarche.pieces, duree: demarche.duree || 30 });
    } catch (err) {
      if (err.statut !== 409) return { ok: false, msg: `Ouverture refusée : ${err.message}` };
    }
  }
  if (!accord) return { ok: false, msg: "Ouverture impossible : réessayez." };
  const requis = accord.statut === "en_attente";
  socle.modifier((e) => {
    e.dossiers[id] = {
      id, service: role.service, iu, agentCode: role.code, agentIu: role.iu, demarche: demarcheId,
      finalite: demarche.nom, but: demarche.finalite, base_legale: demarche.base_legale,
      statut: requis ? "en_attente_citoyen" : "autorise", cree: maintenant(), expire: accord.expire || plusJours(demarche.duree || 30),
      consent: vueAccord(accord),
      pieces: Object.fromEntries(demarche.pieces.map((t) => [t, { statut: requis ? "en_attente" : "recherche" }])),
    };
  });
  socle.journaliser({
    ...auteurDuRole(role), action: "Dossier créé", cible: id, iu,
    details: `${demarche.nom} — ${demarche.pieces.map((t) => TYPES_PIECE[t]).join(", ")}`,
  });
  socle.journaliser({
    casquette: "système", action: "SMS envoyé au citoyen (simulé)", cible: id, iu, service: role.service,
    details: requis
      ? `${nomService(socle.lire(), role.service)} vous demande des pièces : donnez votre accord dans votre espace.`
      : `${nomService(socle.lire(), role.service)} a ouvert le dossier ${id} : « ${demarche.nom} ».`,
  });
  const bilan = requis ? null : await rechercherPieces(id);
  return { ok: true, id, requis, bilan };
}

/** Relance la recherche des pièces indisponibles ou manquantes (registre revenu, service branché depuis). */
export const relancerRecherche = (dossierId) => rechercherPieces(dossierId);

/**
 * Un agent n'ouvre que les dossiers de son service : le serveur ne lui transmet que ceux-là. Pour un autre numéro,
 * le serveur refuse, et journalise la tentative (le citoyen concerné la voit dans son espace).
 */
export async function controlerAcces(role, dossierId) {
  const d = socle.lire().dossiers[dossierId];
  if (d && d.service === role.service) return { ok: true };
  try {
    await lireAccord(dossierId);
  } catch {
    /* refus attendu */
  }
  return { ok: false, msg: "Accès refusé : dossier introuvable ou hors de votre service. Toute tentative est journalisée et visible par le citoyen." };
}

/** Pourquoi une pièce n'est pas consultable (null si elle l'est). */
export function motifRefus(d, type) {
  if (estFinal(d)) return d.statut === "clos" ? "Dossier clôturé : accès désactivés." : "Le citoyen a refusé ou retiré son accord.";
  if (!consentementActif(d)) return "En attente de l'accord du citoyen.";
  if (estExpire(d)) return "Accord expiré.";
  if (!d.consent.autorisees?.includes(type)) return "Pièce non couverte par l'accord.";
  return null;
}

/**
 * Ouvre une pièce en lecture seule. Pour une pièce transmise par un registre, un lien court est redemandé
 * au registre (via la passerelle, qui le journalise) : le fichier ne transite pas par le socle.
 * Chaque consultation (et chaque refus) est aussi journalisée avec le code de l'agent.
 */
export async function consulterPiece(role, dossierId, type) {
  const d = socle.lire().dossiers[dossierId];
  const x = d?.pieces?.[type];
  const motif = !d || !x || d.service !== role.service ? "Accès refusé." : motifRefus(d, type);
  if (motif) {
    if (d) socle.journaliser({ ...auteurDuRole(role), action: "Consultation refusée", cible: `${dossierId} / ${TYPES_PIECE[type]}`, iu: d.iu, resultat: "refusé", details: motif });
    return { ok: false, msg: motif };
  }
  let source = coffre.lire(dossierId, type);
  if (x.provenance === "service") {
    try {
      const l = await lienDocument({ service: x.source, document: x.document, type, iu: d.iu, dossier: dossierId, demandeur: d.service, finalite: d.but || d.finalite });
      source = { url: l.url, type: "application/pdf", expire: l.expire };
    } catch (e) {
      if (e.statut === 403) return { ok: false, msg: e.message };
      // Registre sans lien court (autre format) : on utilise le lien reçu avec la liste.
      source = x.url ? { url: x.url, type: "application/pdf" } : null;
    }
  }
  socle.journaliser({ ...auteurDuRole(role), action: "Pièce consultée", cible: `${dossierId} / ${TYPES_PIECE[type]}`, iu: d.iu, service: d.service });
  return { ok: true, dossier: d, piece: x, type, source };
}

/** Clôture : la couche consentement met fin à l'accord, les liens vers les pièces transmises sont effacés. Le journal est conservé. */
export async function cloreDossier(role, dossierId) {
  const d = socle.lire().dossiers[dossierId];
  const accord = await decider(dossierId, "clore");
  socle.modifier((e) => {
    const x = e.dossiers[dossierId];
    x.statut = "clos";
    x.cloture = maintenant();
    x.consent = vueAccord(accord);
    Object.values(x.pieces).forEach((p) => {
      if (p.provenance === "service") p.url = null;
      p.candidats = null;
    });
    majStatutDossier(x);
  });
  socle.journaliser({ ...auteurDuRole(role), action: "Dossier clôturé", cible: dossierId, iu: d.iu, service: d.service, details: "Accès temporaires désactivés" });
}
