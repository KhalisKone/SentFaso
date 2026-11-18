/**
 * Fichiers déposés par le citoyen, gardés en mémoire dans la maquette.
 * (En production : rangés par service dans le stockage du socle, lus par lien signé.)
 */
const fichiers = new Map();
const cle = (dossierId, type) => `${dossierId}/${type}`;

export const coffre = {
  poser(dossierId, type, fichier) {
    fichiers.set(cle(dossierId, type), { url: URL.createObjectURL(fichier), type: fichier.type, nom: fichier.name, fichier });
  },
  lire: (dossierId, type) => fichiers.get(cle(dossierId, type)) || null,
  vider() {
    fichiers.forEach((f) => URL.revokeObjectURL(f.url));
    fichiers.clear();
  },
};
