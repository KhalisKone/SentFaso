// Stockages PostgreSQL (Supabase) des couches, via l'API REST de Supabase (PostgREST) : fetch seul, aucune dépendance.
// Utilisés par les Edge Functions avec la clé de service ; les politiques RLS ferment ces tables à tout autre accès.

/**
 * En-têtes d'authentification Supabase : une clé JWT (service_role « eyJ… ») va dans apikey ET Authorization ;
 * une nouvelle clé secrète (« sb_secret_… ») va dans apikey seulement (la passerelle la convertit elle-même).
 */
export const entetesCle = cle => (String(cle).startsWith("sb_") ? { apikey: cle } : { apikey: cle, authorization: `Bearer ${cle}` });

export class Rest {
  /** @param {string} url  ex. http://kong:8000 (dans les Edge Functions) ou http://127.0.0.1:54321 */
  constructor(url, cle, schema = "public", fetchFn = fetch) { Object.assign(this, { url: url.replace(/\/$/, ""), cle, schema, fetchFn }); }
  dans(schema) { return new Rest(this.url, this.cle, schema, this.fetchFn); }
  async requete(methode, chemin, corps, entetes = {}) {
    const rep = await this.fetchFn(`${this.url}/rest/v1/${chemin}`, {
      method: methode,
      headers: { ...entetesCle(this.cle), "content-type": "application/json",
        "accept-profile": this.schema, "content-profile": this.schema, prefer: "return=representation", ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps) });
    const texte = await rep.text();
    const donnees = texte ? JSON.parse(texte) : null;
    if (!rep.ok) { const e = new Error(donnees?.message || `PostgREST ${rep.status}`); e.code = donnees?.code; e.statut = rep.status; e.details = donnees; throw e; }
    return donnees;
  }
  select(table, filtre = "") { return this.requete("GET", `${table}?${filtre}`); }
  insert(table, lignes) { return this.requete("POST", table, lignes); }
  upsert(table, lignes, conflit) { return this.requete("POST", `${table}${conflit ? `?on_conflict=${conflit}` : ""}`, lignes, { prefer: "return=representation,resolution=merge-duplicates" }); }
  delete(table, filtre) { return this.requete("DELETE", `${table}?${filtre}`); }
  rpc(fonction, args) { return this.requete("POST", `rpc/${fonction}`, args); }
}
const eq = v => `eq.${encodeURIComponent(v)}`;

/** Journal chaîné : l'insertion passe par une fonction SQL qui verrouille la table et refuse une chaîne concurrente. */
export class JournalPostgres {
  constructor(rest, { table = "journal", fonction = "journal_inserer" } = {}) { Object.assign(this, { rest, table, fonction }); }
  async toutes() { return this.rest.select(this.table, "order=id.asc"); }
  async derniere() { return (await this.rest.select(this.table, "order=id.desc&limit=1"))[0] || null; }
  async parNin(nin) { return this.rest.select(this.table, `nin=${eq(nin)}&order=id.asc`); }
  async inserer(l) {
    try { await this.rest.rpc(this.fonction, { ligne: l }); }
    catch (e) { if (/CHAINE_CONCURRENTE/.test(e.message)) { const c = new Error("chaîne concurrente"); c.code = "CHAINE"; throw c; } throw e; }
  }
}

/** Dossiers et consentements (couche consentement). */
export class DossiersPostgres {
  constructor(rest) { this.rest = rest; }
  async prochainId() { return this.rest.rpc("prochain_dossier", {}); }
  async lire(id) { return (await this.rest.select("dossiers", `id=${eq(id)}`))[0]?.doc || null; }
  async ecrire(d) { await this.rest.upsert("dossiers", [{ id: d.id, nin: d.nin, service: d.service, statut: d.statut, doc: d }], "id"); }
  async parNin(nin) { return (await this.rest.select("dossiers", `nin=${eq(nin)}&order=id.asc`)).map(r => r.doc); }
}

/** Codes de connexion (couche espace usager) : empreinte du code, expiration, essais, envois récents. */
export class CodesPostgres {
  constructor(rest) { this.rest = rest; }
  async lire(nin) { const r = (await this.rest.select("otp", `nin=${eq(nin)}`))[0]; return r ? { empreinte: r.empreinte, expire: Number(r.expire), essais: r.essais, envois: r.envois || [] } : null; }
  async ecrire(nin, c) { await this.rest.upsert("otp", [{ nin, empreinte: c.empreinte, expire: c.expire, essais: c.essais, envois: c.envois || [] }], "nin"); }
}

/** File d'attente de la passerelle (pièces indisponibles à reprendre). */
export class FilePostgres {
  constructor(rest) { this.rest = rest; }
  async toutes() { return (await this.rest.select("file_passerelle", "order=dossier.asc")).map(r => r.demande); }
  async mettre(dossier, demande) { await this.rest.upsert("file_passerelle", [{ dossier, demande }], "dossier"); }
  async retirer(dossier) { await this.rest.delete("file_passerelle", `dossier=${eq(dossier)}`); }
}

/** Un registre : ses pièces, l'état de son point d'accès, les liens déjà utilisés (schéma PostgreSQL propre au registre). */
export class RegistrePostgres {
  constructor(rest) { this.rest = rest; }
  async piecesDe(nin) { return (await this.rest.select("pieces", `nin=${eq(nin)}`)).map(aplatir); }
  async piece(id) { const r = (await this.rest.select("pieces", `id=${eq(id)}`))[0]; return r ? aplatir(r) : null; }
  async nombre() { return (await this.rest.select("pieces", "select=id")).length; }
  async actif() { return (await this.rest.select("point_acces", "id=eq.1"))[0]?.actif !== false; }
  async definirActif(actif) { await this.rest.upsert("point_acces", [{ id: 1, actif }], "id"); }
  /** Marque un lien comme utilisé ; false s'il l'était déjà (usage unique). */
  async utiliserLien(signature) {
    try { await this.rest.insert("liens_utilises", [{ signature }]); return true; }
    catch (e) { if (e.code === "23505") return false; throw e; }
  }
}
const aplatir = r => ({ ...(r.extra || {}), ...Object.fromEntries(Object.entries(r).filter(([k]) => k !== "extra")) });

/** Habilitations (comptes à rôle). */
export class HabilitationsPostgres {
  constructor(rest) { this.rest = rest; }
  async lire(code) { return (await this.rest.select("habilitations", `code=${eq(code)}`))[0] || null; }
  async tous() { return this.rest.select("habilitations", "order=code.asc"); }
  async ecrire(c) { await this.rest.upsert("habilitations", [c], "code"); }
}

/** Téléphone associé à un NIN (vouchers), sans jamais l'exposer hors du serveur. */
export async function telephoneVoucher(rest, nin) {
  const v = (await rest.select("vouchers", `nin=${eq(nin)}`))[0];
  return v ? { telephone: v.telephone, statut: v.statut } : null;
}

/** Lecture d'un document dans Supabase Storage (compartiment privé, clé de service). */
export function lecteurStorage(url, cle, compartiment, prefixe, fetchFn = fetch) {
  return async fichier => {
    const rep = await fetchFn(`${url.replace(/\/$/, "")}/storage/v1/object/${compartiment}/${prefixe}/${fichier}`, { headers: entetesCle(cle) });
    if (!rep.ok) throw new Error(`document introuvable dans le stockage (${rep.status})`);
    return new Uint8Array(await rep.arrayBuffer());
  };
}
