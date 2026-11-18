// Tests du service, pilotés par service.config.json (mêmes tests pour chaque service généré).
import { test } from "node:test";
import assert from "node:assert/strict";
import { creerService, CONFIG } from "../service.js";
import { signatureSocle } from "../socle/api-service/api-service.js";

const SECRET = "secret-de-test";
const monter = () => creerService({ PLATEFORME_SECRET: SECRET, PLATEFORME_CLE_LIENS: "k", URL_PUBLIQUE: "https://service.exemple", DATE_DEMO: "2026-11-16" });
async function appel(service, chemin, { secret = SECRET, decalage = 0 } = {}) {
  const ts = String(Math.floor(Date.now() / 1000) + decalage);
  return service.traiter(new Request(`https://service.exemple${chemin}`, { headers: {
    "X-Socle-Service": "plateforme", "X-Socle-Horodatage": ts, "X-Socle-Signature": await signatureSocle(secret, ts, chemin) } }));
}

test(`${CONFIG.nom} : santé publique (GET et HEAD), registre embarqué`, async () => {
  const s = await monter();
  const d = await (await s.traiter(new Request("https://service.exemple/sante"))).json();
  assert.equal(d.statut, "ok"); assert.equal(d.pieces, CONFIG.exemple.pieces); assert.equal(d.donnees, "embarqué");
  assert.equal((await s.traiter(new Request("https://service.exemple/sante", { method: "HEAD" }))).status, 200);
});

test(`${CONFIG.nom} : identifiant de test (page « brancher »)`, async () => {
  const s = await monter();
  assert.deepEqual(await (await appel(s, "/documents?iu=00000000000000000")).json(), []);
  const v = await appel(s, "/verifier?iu=00000000000000000");
  if (CONFIG.verification) assert.deepEqual(await v.json(), { valide: false });
  else assert.equal(v.status, 404, "service à une seule API : pas de /verifier");
});

test(`${CONFIG.nom} : documents d'un citoyen, au format de la plateforme, téléchargeables`, async () => {
  const s = await monter();
  const docs = await (await appel(s, `/documents?iu=${CONFIG.exemple.nin}&demandeur=direction-des-passeports`)).json();
  assert.deepEqual(docs.map(d => d.type).sort(), [...CONFIG.exemple.types].sort());
  for (const d of docs) {
    assert.ok(d.id && d.titre && d.url.startsWith("https://service.exemple/fichiers/"));
    const f = await s.traiter(new Request(d.url));
    assert.equal(new TextDecoder().decode(new Uint8Array(await f.arrayBuffer()).slice(0, 5)), "%PDF-");
  }
});

test(`${CONFIG.nom} : vérification de l'identifiant (double API seulement)`, { skip: !CONFIG.verification }, async () => {
  const s = await monter();
  assert.deepEqual(await (await appel(s, "/verifier?iu=99000000000000001")).json(), { valide: true, nom: "KABORE", prenoms: "Aminata", date_naissance: "1995-03-14" });
  assert.deepEqual(await (await appel(s, "/verifier?iu=99000000000000050")).json(), { valide: false });
});

test(`${CONFIG.nom} : sécurité (signature fausse, horodatage trop vieux, sans en-têtes → 401)`, async () => {
  const s = await monter();
  assert.equal((await appel(s, `/documents?iu=${CONFIG.exemple.nin}`, { secret: "faux" })).status, 401);
  assert.equal((await appel(s, `/documents?iu=${CONFIG.exemple.nin}`, { decalage: -600 })).status, 401);
  assert.equal((await s.traiter(new Request(`https://service.exemple/documents?iu=${CONFIG.exemple.nin}`))).status, 401);
});

test(`${CONFIG.nom} : règles d'accès du catalogue appliquées (403 pour un demandeur non autorisé)`, async () => {
  const s = await monter();
  const cat = await (await appel(s, "/catalogue")).json();
  for (const [cle, qui] of Object.entries(cat.autorisations)) {
    if (qui.includes("*") || !cat.types.includes(cle)) continue;
    assert.equal((await appel(s, `/documents?iu=${CONFIG.exemple.nin}&types=${cle}&demandeur=service-non-autorise`)).status, 403, cle);
    assert.equal((await appel(s, `/documents?iu=${CONFIG.exemple.nin}&types=${cle}&demandeur=${qui[0]}`)).status, 200, cle);
    assert.deepEqual(await (await appel(s, `/documents?iu=00000000000000000&types=${cle}&demandeur=service-non-autorise`)).json(), []);
  }
});
