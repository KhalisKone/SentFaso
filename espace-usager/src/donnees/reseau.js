/** Réseau simulé (épreuve de panne) et file des dépôts en attente. */

let etat = { enLigne: true, file: [] };
const abonnes = new Set();
const publier = (suivant) => {
  etat = suivant;
  abonnes.forEach((f) => f());
};

export const reseau = {
  lire: () => etat,
  abonner(f) {
    abonnes.add(f);
    return () => abonnes.delete(f);
  },
  basculer() {
    publier({ ...etat, enLigne: !etat.enLigne });
    return etat.enLigne;
  },
  mettreEnFile(element) {
    publier({ ...etat, file: [...etat.file, element] });
  },
  viderFile() {
    const file = etat.file;
    publier({ ...etat, file: [] });
    return file;
  },
};
