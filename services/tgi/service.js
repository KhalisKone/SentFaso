// Service autonome branché sur la plateforme de l'équipe (déployable seul, ex. Render) : il porte SON registre,
// comme en Estonie. Sa configuration est dans service.config.json (généré par services/outils/generer-services.mjs).
// Routes appelées par la plateforme (signature HMAC du socle) :
//   GET /documents?iu=…   GET /verifier?iu=… (double API seulement)   GET /fichiers/{id} (lien signé)
//   GET /catalogue   GET /predicat?iu=…&q=…   GET /lien?iu=…&document=…
// Route publique de surveillance (robot de disponibilité) : GET|HEAD /sante
//
// Données : par défaut le registre embarqué (donnees/ : index CSV + PDF spécimens) ; avec SUPABASE_URL et
// SUPABASE_SERVICE_ROLE_KEY, le registre est lu dans un Supabase HÉBERGÉ (schéma du registre, stockage « registres »).
import { readFile } from "node:fs/promises";
import { randomBytes, createHmac } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { creerApiService } from "./socle/api-service/api-service.js";
import { Journal, JournalMemoire } from "./socle/journal/journal.js";
import { lireCsv } from "./socle/commun/csv.js";
import { Rest, RegistrePostgres, lecteurStorage } from "./socle/commun/postgres.js";

const ICI = dirname(fileURLToPath(import.meta.url));
export const CONFIG = JSON.parse(await readFile(join(ICI, "service.config.json"), "utf8"));

/** Registre embarqué (lecture seule). Identifiants « {registre}-{rang} », comme dans Supabase. */
class RegistreFichiers {
  constructor(pieces) { this.pieces = pieces.map((p, i) => ({ ...p, id: `${CONFIG.registre}-${i + 1}` })); }
  async piecesDe(nin) { return this.pieces.filter(p => p.nin === nin); }
  async piece(id) { return this.pieces.find(p => p.id === id) || null; }
  async nombre() { return this.pieces.length; }
}

/**
 * Base de PERSONNES (ministère : identifiants uniques), au format vouchers : nin,telephone,nom,prenoms,date_naissance,statut,…
 * Vue par /verifier comme une fiche d'identité, UNIQUEMENT si le compte est « actif » (bloqué ou obsolète → non valide).
 * Le téléphone n'est jamais exposé.
 */
const versFiche = p => (p && p.statut === "actif" ? [{ type: "fiche_identite", nin: p.nin, nom: p.nom, prenoms: p.prenoms, date_naissance: p.date_naissance, statut: "valide" }] : []);
class PersonnesFichiers {
  constructor(lignes) { this.lignes = lignes; }
  async piecesDe(nin) { return versFiche(this.lignes.find(p => p.nin === nin)); }
  async piece() { return null; }
  async nombre() { return this.lignes.length; }
}
class PersonnesPostgres {
  constructor(rest, table) { Object.assign(this, { rest, table }); }
  async piecesDe(nin) { return versFiche((await this.rest.select(this.table, `nin=eq.${encodeURIComponent(nin)}&select=nin,nom,prenoms,date_naissance,statut`))[0]); }
  async piece() { return null; }
  async nombre() { return (await this.rest.select(this.table, "select=nin")).length; }
}

/** Journal du service : chaîné SHA-256 en mémoire, chaque ligne est aussi écrite dans les journaux de l'hébergeur. */
class JournalSortie extends JournalMemoire {
  async inserer(l) { await super.inserer(l); console.log(JSON.stringify({ journal: l })); }
}

const liste = v => String(v || "").split(",").map(s => s.trim()).filter(Boolean);

export async function creerService(env = process.env) {
  let stockage, lireFichier, origine;
  const supabase = !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  if (CONFIG.base === "personnes") {
    // Base de personnes (pas de pièces) : /verifier seulement ; /documents renvoie toujours une liste vide.
    stockage = supabase ? new PersonnesPostgres(new Rest(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY), CONFIG.table)
      : new PersonnesFichiers(lireCsv(await readFile(join(ICI, "donnees", CONFIG.fichier), "utf8")));
    lireFichier = async () => { throw Object.assign(new Error("aucun document"), { statut: 404 }); };
    origine = supabase ? "supabase" : "embarqué";
  } else if (supabase) {
    stockage = new RegistrePostgres(new Rest(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY).dans(env.SUPABASE_SCHEMA || CONFIG.schema));
    const lire = lecteurStorage(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, "registres", CONFIG.registre);
    lireFichier = (_id, f) => lire(f);
    origine = "supabase";
  } else {
    const dossier = join(ICI, "donnees");
    stockage = new RegistreFichiers(lireCsv(await readFile(join(dossier, `${CONFIG.registre}.csv`), "utf8")).filter(p => CONFIG.specialite.includes(p.type)));
    lireFichier = async (_id, f) => new Uint8Array(await readFile(join(dossier, f)));
    origine = "embarqué";
  }
  // Clé des liens de téléchargement : PLATEFORME_CLE_LIENS si fournie, sinon DÉRIVÉE du code secret (stable entre
  // redémarrages, jamais écrite dans le dépôt). Sans code secret : clé aléatoire (liens perdus au redémarrage).
  const cleLiens = env.PLATEFORME_CLE_LIENS
    || (env.PLATEFORME_SECRET ? createHmac("sha256", env.PLATEFORME_SECRET).update(`cle-liens:${CONFIG.id}`).digest("hex") : randomBytes(32).toString("hex"));
  const journal = new Journal(new JournalSortie());
  const api = creerApiService({
    nom: CONFIG.nom, prefixe: "", verification: CONFIG.verification, journal,
    secret: env.PLATEFORME_SECRET || "", service: env.PLATEFORME_SERVICE || "",
    registres: CONFIG.base === "personnes" ? [] : [{ id: CONFIG.registre, emetteur: CONFIG.emetteur, stockage }],
    identites: CONFIG.verification ? stockage : undefined, lireFichier,
    types: liste(env.PLATEFORME_TYPES),
    // Catalogue : nos pièces, nos prédicats et nos règles d'accès (service.config.json ; défaut « * » = tous les services).
    specialite: CONFIG.specialite, predicats: CONFIG.predicats || [], autorisations: CONFIG.autorisations || {},
    // Render fournit RENDER_EXTERNAL_URL (adresse publique du service).
    urlPublique: env.URL_PUBLIQUE || env.RENDER_EXTERNAL_URL || "", urlParDefaut: `http://localhost:${env.PORT || 3000}`,
    cleLiens,
    prefixes: liste(env.PLATEFORME_PREFIXES),
    date: env.DATE_DEMO ? () => env.DATE_DEMO : undefined,
  });

  async function traiter(req) {
    const { pathname } = new URL(req.url);
    // GET ou HEAD : les robots de disponibilité (UptimeRobot…) interrogent souvent en HEAD.
    if ((req.method === "GET" || req.method === "HEAD") && (pathname === "/sante" || pathname === "/")) {
      if (req.method === "HEAD") return new Response(null, { status: 200, headers: { "cache-control": "no-store" } });
      return Response.json({ statut: "ok", service: CONFIG.id, nom: CONFIG.nom, double_api: CONFIG.verification, donnees: origine,
        pieces: await stockage.nombre(), configure: !!env.PLATEFORME_SECRET }, { headers: { "cache-control": "no-store" } });
    }
    return api.gestionnaire(req);
  }
  return { traiter, journal, origine };
}
