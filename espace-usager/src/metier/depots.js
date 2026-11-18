/** Dépôt d'une pièce par le citoyen, avec file d'attente quand le réseau est coupé. */
import { coffre } from "../donnees/fichiers.js";
import { reseau } from "../donnees/reseau.js";
import { socle } from "../donnees/socle.js";
import { majStatutDossier } from "../noyau/dossiers.js";
import { maintenant } from "../noyau/format.js";
import { sha256 } from "../noyau/empreinte.js";
import { FORMATS_ACCEPTES, TAILLE_MAX, TYPES_PIECE } from "../noyau/referentiel.js";
import { nomService } from "../noyau/selecteurs.js";

export async function deposer(dossierId, type, fichier, accordDonne) {
  if (!fichier) return { ok: false, msg: "Choisissez un fichier." };
  if (!FORMATS_ACCEPTES.includes(fichier.type)) return { ok: false, msg: "Format refusé : PDF, PNG ou JPEG uniquement." };
  if (fichier.size > TAILLE_MAX) return { ok: false, msg: "Fichier trop lourd (5 Mo maximum)." };
  if (!accordDonne) return { ok: false, msg: "Confirmez l'envoi à ce service." };

  coffre.poser(dossierId, type, fichier);
  if (!reseau.lire().enLigne) {
    socle.modifier((d) => void (d.dossiers[dossierId].pieces[type].statut = "en_file"));
    reseau.mettreEnFile({ dossierId, type });
    return { ok: true, msg: "Hors ligne : dépôt mis en file d'attente." };
  }
  return finaliserDepot(dossierId, type);
}

export async function finaliserDepot(dossierId, type) {
  const f = coffre.lire(dossierId, type);
  const d = socle.lire().dossiers[dossierId];
  if (!d || !f) return { ok: false, msg: "Dépôt introuvable." };
  const empreinte = await sha256(await f.fichier.arrayBuffer());
  socle.modifier((e) => {
    const dossier = e.dossiers[dossierId];
    Object.assign(dossier.pieces[type], {
      statut: "fournie", provenance: "usager", nomFichier: f.nom, taille: f.fichier.size, empreinte, depose: maintenant(),
    });
    majStatutDossier(dossier);
  });
  await socle.journaliser({
    auteur: d.iu, casquette: "citoyen", action: "Pièce déposée", cible: `${dossierId} / ${TYPES_PIECE[type]}`,
    iu: d.iu, service: d.service, details: `empreinte ${empreinte.slice(0, 12)}…`,
  });
  return { ok: true, msg: `${TYPES_PIECE[type]} transmis à ${nomService(socle.lire(), d.service)}.` };
}

/** Coupe ou rétablit le réseau simulé ; au retour, les dépôts en attente partent tout seuls. */
export async function basculerReseau(notifier) {
  if (!reseau.basculer()) return;
  const file = reseau.viderFile();
  if (!file.length) return;
  notifier(`Réseau rétabli : envoi de ${file.length} dépôt(s) en attente…`);
  for (const { dossierId, type } of file) {
    const r = await finaliserDepot(dossierId, type);
    notifier(r.msg);
  }
}
