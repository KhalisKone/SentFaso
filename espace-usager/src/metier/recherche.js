/**
 * Récupération des pièces d'un dossier auprès des registres, par la passerelle.
 * Pièce : une trouvée → transmise ; plusieurs → le citoyen choisit ; registre en panne → « indisponible »
 * (jamais demandée au citoyen) ; refusée par le registre ou absente → le citoyen la charge.
 * Réponse minimale (majeur, casier vierge) : demandée au registre qui la propose, qui ne transmet que oui/non.
 */
import { documentsDe, predicatDe } from "../api/connect.js";
import { socle } from "../donnees/socle.js";
import { estFinal, majStatutDossier } from "../noyau/dossiers.js";
import { maintenant } from "../noyau/format.js";
import { TYPES_PIECE, estPredicat } from "../noyau/referentiel.js";
import { consentementActif, nomService, piecesDe } from "../noyau/selecteurs.js";
import { annuaireRegistres, registresPour } from "./annuaire.js";

/** Pièces à (re)chercher : jamais celles déjà obtenues, choisies, déposées ou refusées par le citoyen. */
const A_CHERCHER = ["en_attente", "recherche", "indisponible", "a_fournir", "sans_source"];
const parService = (liste) => Object.fromEntries(liste.map((r) => [r.service, r]));
const nomsDe = (e, ids) => ids.map((id) => (id === "passerelle" ? "passerelle" : nomService(e, id))).join(", ");

export const transmise = (c) => ({
  statut: "fournie", provenance: "service", source: c.service, nomService: c.nomService, document: c.id,
  titre: c.titre, url: c.url, date: c.date ?? null, depose: maintenant(), candidats: null, pannes: null,
});

export async function rechercherPieces(dossierId) {
  const etat = socle.lire();
  const d = etat.dossiers[dossierId];
  if (!d || estFinal(d) || !consentementActif(d)) return null;
  const types = piecesDe(d).filter(([, x]) => A_CHERCHER.includes(x.statut)).map(([t]) => t);
  if (!types.length) return null;
  socle.modifier((e) => types.forEach((t) => (e.dossiers[dossierId].pieces[t].statut = "recherche")));

  const contexte = { dossier: dossierId, demandeur: d.service, finalite: d.but || d.finalite };
  const annuaire = await annuaireRegistres(etat);
  const vide = { ids: [], refuses: [], declare: false };
  const plan = Object.fromEntries(types.map((t) => [t, annuaire ? registresPour(annuaire, t, d.service) : vide]));
  const documents = types.filter((t) => !estPredicat(t));
  const predicats = types.filter(estPredicat);

  // Un seul appel pour toutes les pièces : chaque registre ne reçoit que les types qui le concernent.
  let reponses = {};
  let passerelleEnPanne = annuaire === null;
  const aInterroger = [...new Set(documents.flatMap((t) => plan[t].ids))];
  if (aInterroger.length) {
    try {
      reponses = parService(await documentsDe(d.iu, aInterroger, { ...contexte, types: documents }));
    } catch {
      passerelleEnPanne = true;
    }
  }
  const reponsesPredicats = {};
  for (const q of predicats) {
    if (!plan[q].ids.length) continue;
    try {
      reponsesPredicats[q] = parService(await predicatDe(d.iu, q, plan[q].ids, contexte));
    } catch {
      reponsesPredicats[q] = null;
    }
  }

  const bilan = { trouvees: 0, aChoisir: 0, indisponibles: 0, aFournir: 0, details: [] };
  socle.modifier((e) => {
    const dossier = e.dossiers[dossierId];
    if (!dossier || estFinal(dossier)) return;
    for (const t of types) {
      const x = dossier.pieces[t];
      const { ids, refuses } = plan[t];
      x.registres = ids;
      let resultat;
      if (estPredicat(t)) {
        const rep = reponsesPredicats[t];
        const pannes = passerelleEnPanne || rep === null ? (ids.length ? ids : ["passerelle"]) : ids.filter((id) => !rep?.[id] || rep[id].erreur);
        const reponse = ids.map((id) => rep?.[id]).find((r) => r && !r.erreur && !r.refus && typeof r.reponse === "boolean");
        if (reponse) {
          Object.assign(x, { statut: "repondu", valeur: reponse.reponse, source: reponse.service, nomService: reponse.nom, pannes: null, refus: null });
          bilan.trouvees++;
          resultat = `${reponse.reponse ? "oui" : "non"}, répondu par ${reponse.nom}`;
        } else if (ids.length && pannes.length) {
          Object.assign(x, { statut: "indisponible", pannes });
          bilan.indisponibles++;
          resultat = `indisponible (${nomsDe(e, pannes)})`;
        } else if (ids.length) {
          Object.assign(x, { statut: "repondu", valeur: null, pannes: null });
          resultat = "personne inconnue du registre";
        } else {
          Object.assign(x, { statut: "sans_source", pannes: null, refus: refuses.length ? refuses : null });
          bilan.indisponibles++;
          resultat = refuses.length ? `refusée par ${nomsDe(e, refuses)}` : "aucun registre ne la fournit";
        }
      } else {
        const pannes = passerelleEnPanne ? (ids.length ? ids : ["passerelle"]) : ids.filter((id) => !reponses[id] || reponses[id].erreur);
        const refus = [...refuses, ...ids.filter((id) => reponses[id]?.refus)];
        // Une réponse en erreur ou refusée ne fournit jamais de pièce.
        const candidats = ids.filter((id) => !reponses[id]?.erreur && !reponses[id]?.refus).flatMap((id) =>
          (reponses[id]?.documents || [])
            .filter((doc) => doc.type === t)
            .map((doc) => ({ service: id, nomService: reponses[id].nom, id: doc.id, titre: doc.titre, url: doc.url, date: doc.date ?? null })),
        );
        x.refus = refus.length ? refus : null;
        if (candidats.length === 1) {
          Object.assign(x, transmise(candidats[0]));
          bilan.trouvees++;
          resultat = `transmise par ${candidats[0].nomService}`;
        } else if (candidats.length > 1) {
          Object.assign(x, { statut: "a_choisir", candidats, pannes: null });
          bilan.aChoisir++;
          resultat = `${candidats.length} pièces trouvées, choix du citoyen`;
        } else if (pannes.length) {
          Object.assign(x, { statut: "indisponible", pannes, candidats: null });
          bilan.indisponibles++;
          resultat = `indisponible (${nomsDe(e, pannes)})`;
        } else {
          Object.assign(x, { statut: "a_fournir", pannes: null, candidats: null });
          bilan.aFournir++;
          resultat = refus.length ? `refusée par ${nomsDe(e, refus)}` : ids.length ? "aucun registre ne la détient" : "aucun registre ne la propose";
        }
      }
      bilan.details.push(`${TYPES_PIECE[t]} : ${resultat}`);
    }
    majStatutDossier(dossier);
  });

  socle.journaliser({
    auteur: "socle", casquette: "système", action: "Pièces demandées aux registres", cible: dossierId,
    iu: d.iu, service: d.service, details: bilan.details.join(" · "),
  });
  return bilan;
}

export function resumeBilan(b) {
  if (!b) return "";
  return [
    b.trouvees && `${b.trouvees} obtenue(s)`,
    b.aChoisir && `${b.aChoisir} à choisir par le citoyen`,
    b.indisponibles && `${b.indisponibles} indisponible(s)`,
    b.aFournir && `${b.aFournir} à fournir par le citoyen`,
  ].filter(Boolean).join(", ");
}
