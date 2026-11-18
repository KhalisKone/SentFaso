// Couche « journal de traçabilité » : journal unique, en ajout seul, chaîné par SHA-256 (socle : règles T1–T7, algorithme REGLES.md §6).
import { routeur, json, lireJson, exiger, erreur } from "../commun/http.js";

export const CHAMPS = ["id", "ts", "auteur", "code", "casquette", "action", "cible", "nin", "service", "resultat", "details", "registre", "donnee", "finalite"];
const ZERO = "0".repeat(64);

export async function sha256(texte) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte));
  return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, "0")).join("");
}
/** Une ligne relue depuis PostgreSQL : id en nombre, horodatage au format ISO exact d'origine (stocké en texte). */
export function normaliser(l) { return { ...l, id: Number(l.id) }; }
export function contenu(ligne) {
  const c = {};
  for (const k of CHAMPS) if (ligne[k] !== undefined) c[k] = ligne[k];   // absent : omis ; null : conservé
  return JSON.stringify(c);
}

/** Stockage en mémoire (tests, démonstration). En production : table `journal` PostgreSQL, sans UPDATE ni DELETE. */
export class JournalMemoire {
  constructor() { this.lignes = []; }
  async toutes() { return this.lignes; }
  async derniere() { return this.lignes[this.lignes.length - 1] || null; }
  async inserer(l) { this.lignes.push(Object.freeze({ ...l })); }
}

export class Journal {
  /** @param {{ toutes(): Promise<any[]>, derniere(): Promise<any>, inserer(l: any): Promise<void> }} [stockage] */
  constructor(stockage = new JournalMemoire(), horloge = () => new Date().toISOString()) {
    this.stockage = stockage; this.horloge = horloge; this.file = Promise.resolve();
  }
  /** Ajoute une ligne (les écritures sont sérialisées pour garder la chaîne). */
  ajouter(e) {
    const tache = this.file.then(async () => {
      exiger(e && e.action, 400, "une ligne de journal doit avoir une action");
      // Plusieurs instances (Edge Functions) peuvent écrire en même temps : la base refuse une ligne dont le « prev »
      // n'est plus le dernier hash ; on recalcule alors la ligne sur la nouvelle fin de chaîne.
      for (let essai = 0; ; essai++) {
        const prec = await this.stockage.derniere();
        const ligne = { id: Number(prec?.id || 0) + 1, ts: this.horloge(), auteur: null, code: null, casquette: "système", cible: null, nin: null, service: null,
          resultat: "réussi", details: null, registre: null, donnee: null, finalite: null, ...e };
        for (const k of Object.keys(ligne)) if (!CHAMPS.includes(k)) delete ligne[k];
        ligne.prev = prec?.hash || ZERO;
        ligne.hash = await sha256(contenu(ligne) + ligne.prev);
        try { await this.stockage.inserer(ligne); return ligne; }
        catch (err) { if (err.code !== "CHAINE" || essai >= 9) throw err; }
      }
    });
    this.file = tache.catch(() => {});
    return tache;
  }
  /** Lignes concernant un citoyen (« Suivi de mes données », règle T6). */
  async suivi(nin) { return this.stockage.parNin ? this.stockage.parNin(nin) : (await this.stockage.toutes()).filter(l => l.nin === nin); }
  /** Recalcule toute la chaîne (règle T3). */
  async verifier() { return verifierLignes(await this.stockage.toutes()); }
}

export async function verifierLignes(lignesBrutes) {
  let prev = ZERO;
  const lignes = lignesBrutes.map(normaliser);
  for (const [i, l] of lignes.entries()) {
    if (l.id !== i + 1) return { integre: false, ligne: l.id ?? i + 1, motif: "numérotation rompue (ligne supprimée ou insérée)" };
    if (l.prev !== prev) return { integre: false, ligne: l.id, motif: "lien vers la ligne précédente rompu" };
    if (await sha256(contenu(l) + prev) !== l.hash) return { integre: false, ligne: l.id, motif: "contenu modifié" };
    prev = l.hash;
  }
  return { integre: true, total: lignes.length, dernier_hash: prev };
}

/**
 * API HTTP de la couche (voir openapi.yaml).
 * L'écriture est réservée aux couches internes (clé de service) ; la lecture du suivi est réservée au citoyen concerné.
 * @param {Journal} journal
 * @param {{ cleService: string, citoyenDe: (req: Request) => Promise<string|null> }} securite
 */
export function apiJournal(journal, securite) {
  return routeur([
    ["POST", "/lignes", async (req) => {
      exiger(req.headers.get("x-cle-service") === securite.cleService, 401, "réservé aux couches du socle");
      return json(await journal.ajouter(await lireJson(req)), 201);
    }],
    ["GET", "/citoyens/{nin}/suivi", async (req, p) => {
      const nin = await securite.citoyenDe(req);
      if (nin !== p.nin) return erreur(403, "un citoyen ne lit que ses propres lignes");
      return json({ nin: p.nin, lignes: (await journal.suivi(p.nin)).slice().reverse() });
    }],
    ["GET", "/integrite", async () => json(await journal.verifier())],
  ], { prefixe: "/journal" });
}
