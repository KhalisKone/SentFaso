// Petit routeur HTTP sur les Web APIs (Request / Response) : le même gestionnaire sert dans une
// Edge Function Supabase (Deno.serve(gestionnaire)) et dans les tests Node (gestionnaire(new Request(...))).

export function json(donnees, statut = 200, entetes = {}) {
  return new Response(JSON.stringify(donnees), { status: statut, headers: { "content-type": "application/json; charset=utf-8", ...entetes } });
}
export function erreur(statut, message, details) {
  return json({ erreur: message, ...(details ? { details } : {}) }, statut);
}

/**
 * Crée un gestionnaire à partir d'une table de routes.
 * Les chemins acceptent des paramètres « {nom} ». Le préfixe (ex. « /passerelle ») est ignoré s'il est présent.
 * @param {Array<[string, string, (req: Request, p: Record<string,string>, url: URL) => Promise<Response>|Response]>} routes
 * @param {{ prefixe?: string }} [options]
 */
export function routeur(routes, options = {}) {
  const compilees = routes.map(([methode, chemin, action]) => {
    const noms = [];
    const motif = new RegExp("^" + chemin.replace(/\{(\w+)\}/g, (_, n) => { noms.push(n); return "([^/]+)"; }) + "/?$");
    return { methode, motif, noms, action };
  });
  async function gestionnaire(req) {
    const url = new URL(req.url);
    let chemin = url.pathname;
    if (options.prefixe && chemin.startsWith(options.prefixe)) chemin = chemin.slice(options.prefixe.length) || "/";
    for (const r of compilees) {
      const m = chemin.match(r.motif);
      if (!m) continue;
      if (r.methode !== req.method) continue;
      const params = Object.fromEntries(r.noms.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      try { return await r.action(req, params, url); }
      catch (e) { return erreur(e.statut || 500, e.message || "erreur interne"); }
    }
    return erreur(404, `aucune route pour ${req.method} ${chemin}`);
  }
  gestionnaire.routes = routes.map(([methode, chemin]) => [methode, chemin]);   // introspection (test de conformité OpenAPI)
  return gestionnaire;
}

export async function lireJson(req) {
  try { return await req.json(); } catch { const e = new Error("corps JSON invalide"); e.statut = 400; throw e; }
}
export function exiger(condition, statut, message) {
  if (!condition) { const e = new Error(message); e.statut = statut; throw e; }
}
