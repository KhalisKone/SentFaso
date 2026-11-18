/**
 * Store de l'état du socle, indépendant de React.
 * L'état visible par la personne connectée est lu depuis /etat (filtré par le serveur selon ses rôles), puis réécrit
 * (PUT) peu après chaque modification : le serveur n'applique que ce que la personne a le droit de modifier.
 * Chaque modification se fait sur une copie : l'état publié n'est jamais muté.
 * Le journal n'est pas réécrit avec l'état : il est tenu par le serveur, qui scelle chaque ligne (voir api/journal.js).
 */
import { ajouterLigne, lireJournal } from "../api/journal.js";
import { ecrireEtat, lireEtat } from "../api/socle.js";

const vide = () => ({
  personnes: {}, preferences: {}, services: {}, demarches: {}, dossiers: {}, journal: [], roles: [],
  seq: { role: 2, dossier: 0, SA: 1, AD: 0, AG: 0 },
});
/** Firebase rend parfois les listes sous forme d'objet et supprime les objets vides. */
const liste = (x) => (Array.isArray(x) ? x.filter(Boolean) : Object.values(x || {}));

let etat = vide();
let statut = "inactif"; // inactif | chargement | pret | erreur
let minuterie = null;
let ecritureEnAttente = false;
let chaineJournal = Promise.resolve();
const abonnes = new Set();
const ecouteursErreur = new Set();

const emettre = () => abonnes.forEach((f) => f());
const signaler = (message) => ecouteursErreur.forEach((f) => f(message));

const parNumero = (lignes) => liste(lignes).sort((a, b) => a.id - b.id);
function normaliser(brut, journal) {
  const b = brut || {};
  return { ...vide(), ...b, seq: { ...vide().seq, ...(b.seq || {}) }, roles: liste(b.roles), journal: parNumero(journal) };
}
/** Ajoute ou remplace des lignes du journal sans réécrire l'état (le journal n'est jamais envoyé par PUT). */
function fusionnerJournal(lignes) {
  const parId = new Map(etat.journal.map((l) => [l.id, l]));
  lignes.forEach((l) => parId.set(l.id, l));
  etat = { ...etat, journal: parNumero([...parId.values()]) };
  emettre();
}

let ecritureEnCours = Promise.resolve();
async function ecrire() {
  minuterie = null;
  try {
    const { journal: _horsEtat, ...aEcrire } = etat;
    await ecrireEtat(aEcrire);
  } catch {
    signaler("Enregistrement impossible : le socle est injoignable.");
  } finally {
    if (!minuterie) ecritureEnAttente = false;
  }
}
function planifierEcriture() {
  ecritureEnAttente = true;
  clearTimeout(minuterie);
  minuterie = setTimeout(() => (ecritureEnCours = ecrire()), 200);
}

export const socle = {
  lire: () => etat,
  statut: () => statut,
  abonner(f) {
    abonnes.add(f);
    return () => abonnes.delete(f);
  },
  surErreur(f) {
    ecouteursErreur.add(f);
    return () => ecouteursErreur.delete(f);
  },

  async charger() {
    if (statut === "chargement") return;
    statut = "chargement";
    emettre();
    try {
      const [brut, journal] = await Promise.all([lireEtat(), lireJournal()]);
      etat = normaliser(brut, journal);
      statut = "pret";
    } catch (e) {
      statut = e?.statut === 401 ? "inactif" : "erreur"; // session expirée : retour à la connexion
    }
    emettre();
  },

  /** Relit l'état du serveur (changement d'espace, retour sur l'onglet), sauf écriture en cours. */
  async rafraichir() {
    if (statut !== "pret" || ecritureEnAttente) return;
    try {
      const [brut, journal] = await Promise.all([lireEtat(), lireJournal()]);
      if (!ecritureEnAttente) {
        etat = normaliser(brut, journal);
        emettre();
      }
    } catch {
      /* hors ligne : on garde l'état en mémoire */
    }
  },

  /** Applique une modification sur une copie de l'état, publie, puis enregistre. Renvoie le résultat de `fn`. */
  modifier(fn) {
    const brouillon = structuredClone(etat);
    const resultat = fn(brouillon);
    etat = brouillon;
    emettre();
    planifierEcriture();
    return resultat;
  },

  /** Envoie une ligne au journal du serveur, qui la numérote, l'horodate et la scelle. Les envois partent dans l'ordre. */
  journaliser(entree) {
    chaineJournal = chaineJournal
      .then(async () => fusionnerJournal([await ajouterLigne(entree)]))
      .catch(() => signaler("Écriture au journal impossible : le socle est injoignable."));
    return chaineJournal;
  },

  /** Relit le journal (lignes écrites par la passerelle ou par d'autres postes). */
  async relireJournal() {
    try {
      const journal = await lireJournal();
      etat = { ...etat, journal: parNumero(journal) };
      emettre();
    } catch {
      /* hors ligne */
    }
  },

  /** Envoie tout de suite ce qui attend encore (modification de l'état, lignes du journal) : avant une déconnexion. */
  async enregistrerMaintenant() {
    if (minuterie) {
      clearTimeout(minuterie);
      ecritureEnCours = ecrire();
    }
    await Promise.all([ecritureEnCours, chaineJournal]);
  },

  /** Oublie l'état chargé (déconnexion) : la prochaine personne connectée relira sa propre vue. */
  vider() {
    clearTimeout(minuterie);
    minuterie = null;
    ecritureEnAttente = false;
    etat = vide();
    statut = "inactif";
    emettre();
  },
};
