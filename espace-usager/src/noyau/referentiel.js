/** Vocabulaire commun du socle : acteurs, types de pièces, types de services, statuts. */

export const ACTEURS = {
  citoyen: { libelle: "Citoyen", ico: "👤", slug: "citoyen", titre: "Espace citoyen" },
  agent: { libelle: "Agent", ico: "🗂️", slug: "agent", titre: "Espace agent" },
  admin: { libelle: "Admin de service", ico: "🧑‍💼", slug: "admin", titre: "Espace admin de service" },
  super_admin: { libelle: "Super admin", ico: "🏛️", slug: "super-admin", titre: "Espace super admin" },
};
export const ORDRE_ACTEURS = ["citoyen", "agent", "admin", "super_admin"];
export const acteurDuSlug = (slug) => ORDRE_ACTEURS.find((a) => ACTEURS[a].slug === slug) || null;
export const libRole = (r) => ({ citoyen: "Citoyen", agent: "Agent", admin: "Admin", super_admin: "Super admin", "système": "Le socle", passerelle: "La passerelle" }[r] || r);

/** Types de pièces : c'est le code « type » renvoyé par l'API documents des services. */
export const TYPES_PIECE = {
  acte_naissance: "Acte de naissance",
  certificat_nationalite: "Certificat de nationalité",
  casier_judiciaire: "Extrait de casier judiciaire",
  certificat_residence: "Certificat de résidence",
  acte_mariage: "Acte de mariage",
  photo_identite: "Photo d'identité",
  majeur: "Majeur : oui/non",
  casier_vierge: "Casier judiciaire vierge : oui/non",
};
/** Réponses minimales (oui/non) : le registre répond sans transmettre la donnée source (date de naissance, mentions du casier). */
export const PREDICATS = ["majeur", "casier_vierge"];
export const estPredicat = (code) => PREDICATS.includes(code);
/** Pièces délivrées sous forme de document. */
export const TYPES_DOCUMENT = Object.keys(TYPES_PIECE).filter((t) => !estPredicat(t));

export const TYPES_SERVICE = {
  ministere: "Ministère",
  direction: "Direction / service rattaché",
  etablissement: "Établissement public",
  collectivite: "Collectivité territoriale (mairie, région)",
  juridiction: "Juridiction (tribunal)",
};

export const STATUT_DOSSIER = {
  en_attente_citoyen: ["att", "En attente du citoyen"],
  autorise: ["info", "Pièces en cours"],
  complet: ["ok", "Complet"],
  refuse: ["ko", "Refusé par le citoyen"],
  revoque: ["ko", "Accord retiré"],
  clos: ["neutre", "Clôturé"],
};
export const STATUT_PIECE = {
  en_attente: ["att", "En attente de l'accord"],
  recherche: ["info", "Recherche en cours"],
  a_choisir: ["att", "À choisir par le citoyen"],
  indisponible: ["ko", "Indisponible (registre en panne)"],
  sans_source: ["ko", "Aucun registre ne la fournit"],
  a_fournir: ["att", "À fournir"],
  en_file: ["info", "Envoi en attente (hors ligne)"],
  fournie: ["ok", "Obtenue"],
  repondu: ["ok", "Répondu"],
  refusee: ["ko", "Refusée par le citoyen"],
};

/** Dépôt des pièces par le citoyen. */
export const CONSERVATION_MOIS = 12;
export const FORMATS_ACCEPTES = ["application/pdf", "image/png", "image/jpeg"];
export const TAILLE_MAX = 5 * 1024 * 1024;
