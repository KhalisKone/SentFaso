/**
 * Profils de test (mode démonstration seulement) : codes uniques de personnes fictives, présentes dans les registres de
 * démonstration et dans le registre d'identité. Un clic sur « Données de test » remplit le champ avec le profil choisi.
 */
export const PROFILS_TEST = {
  connexion: [
    ["99000000000000001", "Super admin (aussi citoyenne : Aminata KABORE)"],
    ["99000000000000021", "Admin — Direction des passeports"],
    ["99000000000000022", "Admin — Office national d'identification"],
    ["99000000000000023", "Admin — Ministère de la Fonction publique"],
    ["99000000000000033", "Agent — Direction des passeports"],
    ["99000000000000034", "Agent — Office national d'identification"],
    ["99000000000000035", "Agent — Ministère de la Fonction publique"],
    ["99000000000000036", "Citoyenne — Alimata TAPSOBA (toutes ses pièces)"],
    ["99000000000000017", "Citoyenne — Aïssata DIALLO (casier non vierge)"],
    ["99000000000000002", "Citoyen — Issouf OUEDRAOGO (mineur)"],
  ],
  dossier: [
    ["99000000000000036", "Alimata TAPSOBA — toutes les pièces arrivent"],
    ["99000000000000001", "Aminata KABORE — toutes les pièces arrivent"],
    ["99000000000000002", "Issouf OUEDRAOGO — mineur : « majeur : non »"],
    ["99000000000000017", "Aïssata DIALLO — « casier vierge : non »"],
    ["99000000000000010", "Rasmané ILBOUDO — acte chez deux registres : à choisir *"],
    ["99000000000000025", "Rasmata OUEDRAOGO — aucun acte de naissance : à fournir *"],
  ],
  nomination: [
    ["99000000000000008", "Awa OUATTARA (sans rôle)"],
    ["99000000000000009", "Jean-Baptiste SANOU (sans rôle)"],
    ["99000000000000011", "Adama KONATE (sans rôle)"],
    ["99000000000000015", "Clarisse YAMEOGO (sans rôle)"],
  ],
  calcul: [
    ["99000000000000036", "Alimata TAPSOBA — majeure"],
    ["99000000000000002", "Issouf OUEDRAOGO — mineur"],
  ],
};

export const NOTE_PROFILS = {
  dossier: "* Selon les registres branchés : garantis avec les registres de démonstration (démonstration locale).",
};
