// Couche « API d'un service » branché sur la plateforme de l'équipe (page « brancher un service ») : ce que la
// plateforme appelle chez chaque service (ONI : double API ; Direction des passeports : documents seulement).
//   GET /documents?iu=…   documents que nos registres détiennent sur le citoyen (les fichiers restent chez nous)
//   GET /verifier?iu=…    (double API seulement) confirmation qu'un identifiant unique (NIN, 17 chiffres) existe, pour connecter le citoyen
//   GET /catalogue        ce que nous proposons (types, prédicats) et à qui (règles d'accès ; « * » = tous)
//   GET /predicat?iu=…&q=…  réponse minimale oui / non (majeur, casier_vierge) sans la donnée source ; null = inconnu
//   GET /lien?iu=…&document=…  lien court vers un document, redemandé à chaque consultation
//   /documents, /predicat et /lien reçoivent aussi demandeur (contrôlé par nos règles : 403 sinon), dossier, finalite (journal).
//   GET /fichiers/{id}    téléchargement d'un document par lien signé à durée courte (adresse renvoyée par /documents)
// Chaque appel du socle est authentifié : X-Socle-Service, X-Socle-Horodatage (secondes Unix, ±5 min),
// X-Socle-Signature = HMAC-SHA256 hexadécimal (clé = code secret ; message = horodatage \n GET \n chemin?requête).
// Chaque réponse de /documents et /verifier est signée à son tour (authentification mutuelle) :
// X-Registre-Horodatage (secondes Unix), X-Registre-Signature = HMAC-SHA256 hexadécimal (même code secret ;
// message = horodatage \n chemin?requête reçu \n SHA-256 hexadécimal du corps exact envoyé).
// Chaque consultation est inscrite au journal : le citoyen la retrouve dans « Suivi de mes données ».
import { routeur, exiger } from "../commun/http.js";
import { aujourdhui } from "../commun/csv.js";

/** Types de pièces reconnus par la plateforme (son vocabulaire = le nôtre pour ces types). */
export const TYPES_PLATEFORME = ["acte_naissance", "certificat_nationalite", "casier_judiciaire", "certificat_residence", "acte_mariage", "photo_identite"];
const TITRES = {
  acte_naissance: "Extrait d'acte de naissance", certificat_nationalite: "Certificat de nationalité",
  casier_judiciaire: "Bulletin n° 3 du casier judiciaire", certificat_residence: "Certificat de résidence",
  acte_mariage: "Extrait d'acte de mariage", photo_identite: "Photo d'identité",
  passeport: "Passeport", fiche_identite: "Fiche d'identification (ONI)",
};
const IU = /^\d{17}$/;
export const IU_TEST = "00000000000000000";
const liste = v => String(v || "").split(",").map(s => s.trim()).filter(Boolean);
const enc = s => new TextEncoder().encode(s);
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");

async function hmacHex(cle, message) {
  const k = await crypto.subtle.importKey("raw", enc(cle), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc(message)));
}
/** Comparaison en temps constant. */
function egal(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
/** Âge révolu à la date `a` (AAAA-MM-JJ). */
export function estMajeur(dateNaissance, a) {
  const [an, mn, jn] = dateNaissance.split("-").map(Number), [aa, ma, ja] = a.split("-").map(Number);
  let age = aa - an; if (ma < mn || (ma === mn && ja < jn)) age--;
  return age >= 18;
}
/**
 * Réponses minimales (route /predicat) : oui / non SANS transmettre la donnée source ; null si nous ne pouvons pas
 * conclure (personne inconnue chez nous, aucune pièce utile).
 */
export const PREDICATS = {
  majeur: { nonTransmis: "date de naissance",
    evaluer: (pieces, ajd) => { const f = pieces.find(x => /^\d{4}-\d{2}-\d{2}$/.test(x.date_naissance || "")); return f ? estMajeur(f.date_naissance, ajd) : null; } },
  casier_vierge: { nonTransmis: "bulletin n° 3",
    evaluer: (pieces, ajd) => {
      const b = pieces.filter(x => x.type === "casier_judiciaire" && (!x.valide_jusqua || x.valide_jusqua >= ajd));
      return b.length ? b.every(x => !x.condamnations || /^n[ée]ant$/i.test(x.condamnations)) : null;
    } },
};

/** Signature d'une réponse, telle que la vérifie la passerelle (exportée pour les tests). */
export const signatureReponse = async (secret, horodatage, cheminRequete, corps) =>
  hmacHex(secret, `${horodatage}\n${cheminRequete}\n${hex(await crypto.subtle.digest("SHA-256", corps))}`);
/** Signature telle que la calcule la plateforme (exportée pour les tests et l'outil de simulation). */
export const signatureSocle = (secret, horodatage, cheminRequete, methode = "GET") => hmacHex(secret, `${horodatage}\n${methode}\n${cheminRequete}`);

/**
 * @param {object} cfg
 * @param {string} cfg.nom                    nom du service (messages)
 * @param {string} cfg.prefixe                préfixe de chemin de l'Edge Function (ex. « /api-oni »)
 * @param {boolean} [cfg.verification]        double API : expose aussi /verifier (nécessite cfg.identites)
 * @param {string[]} [cfg.types]              types acceptés par la plateforme (défaut : TYPES_PLATEFORME)
 * @param {string[]} [cfg.specialite]       types de pièces que nous détenons (défaut : tous ceux de la plateforme)
 * @param {string[]} [cfg.predicats]        prédicats auxquels nous répondons (parmi PREDICATS)
 * @param {Record<string,string[]>} [cfg.autorisations]  services autorisés par type ou prédicat (défaut : ["*"])
 * @param {string} cfg.secret                code secret remis par la plateforme de l'équipe pour CE service
 * @param {string} [cfg.service]              identifiant de service attendu (X-Socle-Service) ; vide = non contrôlé
 * @param {Array<{ id: string, emetteur: string, stockage: { piecesDe(nin): Promise<object[]>, piece(id): Promise<object|null> } }>} cfg.registres
 * @param {{ piecesDe(nin): Promise<object[]> }} [cfg.identites]  registre d'identité (fiches de l'ONI), pour /verifier
 * @param {(registre: string, fichier: string) => Promise<Uint8Array>} cfg.lireFichier
 * @param {{ ajouter(l: object): Promise<any> }} cfg.journal
 * @param {string} [cfg.urlPublique]          adresse publique de cette API (pour les liens /fichiers)
 * @param {string} [cfg.urlParDefaut]         à défaut (accès local direct)
 * @param {boolean} [cfg.urlDepuisEntete]     sans urlPublique : accepter l'adresse annoncée par le relais (X-Url-Publique)
 * @param {string} cfg.cleLiens               clé de signature de NOS liens de téléchargement
 * @param {string[]} [cfg.prefixes]           préfixes possibles du chemin signé (le socle signe le chemin public)
 * @param {number} [cfg.dureeLienS]
 * @param {() => string} [cfg.date]           date du jour AAAA-MM-JJ (validité des pièces)
 * @param {() => number} [cfg.horloge]        millisecondes
 */
export function creerApiService(cfg) {
  const types = cfg.types?.length ? cfg.types : TYPES_PLATEFORME;
  const nom = cfg.nom || "service";
  const horloge = cfg.horloge || (() => Date.now());
  const date = cfg.date || (() => aujourdhui());
  const prefixes = cfg.prefixes?.length ? cfg.prefixes : ["", "/functions/v1"];
  // Ce que nous proposons, et à qui (route /catalogue) : types de pièces (notre spécialité ∩ vocabulaire de la
  // plateforme), prédicats, et règles d'accès par type ou prédicat (« * » = tous les services ; défaut : tous).
  const typesProposes = (cfg.specialite || types).filter(t => types.includes(t));
  const predicats = (cfg.predicats || []).filter(q => PREDICATS[q]);
  const autorisations = Object.fromEntries([...typesProposes, ...predicats].map(k => [k, cfg.autorisations?.[k] || ["*"]]));
  const autorise = (cle, demandeur) => (autorisations[cle] || []).some(d => d === "*" || d === demandeur);
  const contexte = url => ["dossier", "finalite"].map(k => url.searchParams.get(k) ? `${k} ${url.searchParams.get(k)}` : "").filter(Boolean).join(" ; ");
  /** Toutes les pièces du citoyen chez nous (registres + fiche d'identité), pour évaluer un prédicat. */
  async function toutesPieces(iu) {
    const sources = [...cfg.registres.map(r => r.stockage), ...(cfg.identites ? [cfg.identites] : [])];
    return (await Promise.all([...new Set(sources)].map(s => s.piecesDe(iu)))).flat();
  }
  const dureeLien = cfg.dureeLienS || 900;
  const urlPublique = String(cfg.urlPublique || "").replace(/\/$/, "");

  async function refuser(motif, service) {
    await cfg.journal.ajouter({ action: "Appel refusé (plateforme)", casquette: "plateforme", service: service || null, resultat: "refusé", details: motif });
    exiger(false, 401, "appel non authentifié");
  }

  /** Authentifie l'appel de la plateforme ; renvoie l'identifiant de service appelant et le chemin?requête signé. */
  async function controler(req, url) {
    exiger(cfg.secret, 503, `API du service ${nom} non configurée : code secret manquant`);
    const service = req.headers.get("x-socle-service") || "";
    const ts = req.headers.get("x-socle-horodatage") || "";
    const signature = (req.headers.get("x-socle-signature") || "").trim().toLowerCase();
    if (!/^\d{1,12}$/.test(ts) || Math.abs(horloge() / 1000 - Number(ts)) > 300) return refuser("horodatage absent ou écart de plus de 5 minutes", service);
    if (cfg.service && service !== cfg.service) return refuser("identifiant de service inattendu", service);
    const cheminRequete = url.pathname + url.search;
    for (const p of prefixes) if (egal(signature, await signatureSocle(cfg.secret, ts, p + cheminRequete, req.method))) return { service, chemin: p + cheminRequete };
    return refuser("signature invalide", service);
  }

  /** Réponse JSON signée : le corps est sérialisé une seule fois, ces octets sont signés puis envoyés tels quels. */
  async function jsonSigne(donnees, chemin, statut = 200) {
    const corps = enc(JSON.stringify(donnees));
    const ts = String(Math.floor(horloge() / 1000));
    return new Response(corps, { status: statut, headers: { "content-type": "application/json; charset=utf-8",
      "x-registre-horodatage": ts, "x-registre-signature": await signatureReponse(cfg.secret, ts, chemin, corps) } });
  }

  const iuDe = url => { const iu = url.searchParams.get("iu") || ""; exiger(IU.test(iu), 400, "iu : identifiant unique de 17 chiffres attendu"); return iu; };

  /**
   * Adresse publique des liens : celle de la configuration, sinon (tunnel dont l'adresse change) celle que le relais
   * local indique dans X-Url-Publique, pour un appel déjà authentifié. Le format est contrôlé (https, sans requête).
   */
  function baseLiens(req) {
    if (urlPublique) return urlPublique;
    const annoncee = cfg.urlDepuisEntete ? (req.headers.get("x-url-publique") || "") : "";
    if (/^https:\/\/[a-z0-9.-]+(:\d{1,5})?(\/[\w\-/]*)?$/i.test(annoncee)) return annoncee.replace(/\/$/, "");
    return String(cfg.urlParDefaut || "").replace(/\/$/, "");
  }
  async function lien(base, id) {
    const exp = Math.floor(horloge() / 1000) + dureeLien;
    return `${base}/fichiers/${encodeURIComponent(id)}?exp=${exp}&sig=${await hmacHex(cfg.cleLiens, `${id}\n${exp}`)}`;
  }

  async function documents(req, _p, url) {
    const { service, chemin } = await controler(req, url);
    const iu = iuDe(url);
    if (iu === IU_TEST) return jsonSigne([], chemin);   // l'identifiant de test : toujours une liste vide, quelles que soient les règles
    // Types demandés (paramètre « types ») parmi ceux que nous proposons ; puis nos règles d'accès pour ce demandeur.
    const demandeur = url.searchParams.get("demandeur") || "";
    const demandes = liste(url.searchParams.get("types"));
    const voulus = demandes.length ? typesProposes.filter(t => demandes.includes(t)) : typesProposes;
    const permis = voulus.filter(t => autorise(t, demandeur));
    // 403 si un type EXPLICITEMENT demandé nous est refusé pour ce demandeur, ou si rien de ce qu'il pourrait voir ne lui est permis.
    if ((demandes.length && permis.length < voulus.length) || (voulus.length && !permis.length)) {
      await cfg.journal.ajouter({ action: "Documents refusés à la plateforme", casquette: "plateforme", service: service || null, nin: iu, resultat: "refusé",
        details: `demandeur ${demandeur || "non précisé"} non autorisé pour ${voulus.filter(t => !permis.includes(t)).join(", ")}${contexte(url) ? ` (${contexte(url)})` : ""}` });
      return jsonSigne({ erreur: "demandeur non autorisé par nos règles d'accès" }, chemin, 403);
    }
    const ajd = date(), docs = [], base = baseLiens(req);
    exiger(base, 503, "adresse publique de l'API inconnue (PLATEFORME_URL_PUBLIQUE ou relais)");
    for (const r of cfg.registres) {
      for (const p of await r.stockage.piecesDe(iu)) {
        if (!permis.includes(p.type) || (p.valide_jusqua && p.valide_jusqua < ajd)) continue;
        const emis = p.delivre_le || p.date_acte;
        docs.push({ id: p.id, type: p.type, titre: `${TITRES[p.type] || p.type} n° ${p.numero}`, ...(/^\d{4}-\d{2}-\d{2}$/.test(emis || "") ? { date: emis } : {}), url: await lien(base, p.id) });
      }
    }
    await cfg.journal.ajouter({ action: "Documents listés pour la plateforme", casquette: "plateforme", service: service || null, nin: iu,
      details: (docs.length ? `${docs.length} document(s) : ${[...new Set(docs.map(d => d.type))].join(", ")} (liens de ${dureeLien / 60} min ; fichiers non copiés)` : "aucun document")
        + (demandeur ? ` ; demandeur ${demandeur}` : "") + (contexte(url) ? ` ; ${contexte(url)}` : "") });
    return jsonSigne(docs, chemin);
  }

  /** Ce que nous proposons, et à qui. */
  async function catalogue(req, _p, url) {
    const { chemin } = await controler(req, url);
    return jsonSigne({ types: typesProposes, predicats, autorisations }, chemin);
  }

  /** Réponse minimale : oui / non sans transmettre la donnée ; null si la personne nous est inconnue. */
  async function predicat(req, _p, url) {
    const { service, chemin } = await controler(req, url);
    const iu = iuDe(url), q = url.searchParams.get("q") || "", demandeur = url.searchParams.get("demandeur") || "";
    exiger(/^[a-z_]{1,40}$/.test(q), 400, "q : nom de prédicat attendu (ex. majeur)");
    if (iu === IU_TEST || !predicats.includes(q)) return jsonSigne({ q, reponse: null }, chemin);
    if (!autorise(q, demandeur)) {
      await cfg.journal.ajouter({ action: "Réponse minimale refusée à la plateforme", casquette: "plateforme", service: service || null, nin: iu, donnee: q,
        resultat: "refusé", details: `demandeur ${demandeur || "non précisé"} non autorisé` });
      return jsonSigne({ erreur: "demandeur non autorisé par nos règles d'accès" }, chemin, 403);
    }
    const reponse = PREDICATS[q].evaluer(await toutesPieces(iu), date());
    await cfg.journal.ajouter({ action: "Réponse minimale donnée à la plateforme", casquette: "plateforme", service: service || null, nin: iu, donnee: q,
      resultat: reponse === null ? "inconnu" : "réussi",
      details: `« ${q} » : ${reponse === null ? "ne peut pas conclure" : reponse ? "oui" : "non"} (${PREDICATS[q].nonTransmis} non transmise)`
        + (demandeur ? ` ; demandeur ${demandeur}` : "") + (contexte(url) ? ` ; ${contexte(url)}` : "") });
    return jsonSigne({ q, reponse }, chemin);
  }

  /** Lien court vers un document, redemandé à chaque consultation (le fichier ne passe pas par le socle). */
  async function lienCourt(req, _p, url) {
    const { service, chemin } = await controler(req, url);
    const iu = iuDe(url), id = url.searchParams.get("document") || "", demandeur = url.searchParams.get("demandeur") || "";
    const r = cfg.registres.find(x => id.startsWith(`${x.id}-`));
    const piece = iu !== IU_TEST && r ? await r.stockage.piece(id) : null;
    if (!piece || piece.nin !== iu || !typesProposes.includes(piece.type)) return jsonSigne({ erreur: "document introuvable" }, chemin, 404);
    if (!autorise(piece.type, demandeur)) return jsonSigne({ erreur: "demandeur non autorisé par nos règles d'accès" }, chemin, 403);
    const base = baseLiens(req);
    exiger(base, 503, "adresse publique de l'API inconnue (PLATEFORME_URL_PUBLIQUE ou relais)");
    const expire = new Date((Math.floor(horloge() / 1000) + dureeLien) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
    await cfg.journal.ajouter({ action: "Lien court remis à la plateforme", casquette: "plateforme", service: service || null, nin: iu, donnee: piece.type, cible: piece.id,
      details: `valable ${dureeLien / 60} min` + (demandeur ? ` ; demandeur ${demandeur}` : "") });
    return jsonSigne({ url: await lien(base, piece.id), expire }, chemin);
  }

  async function verifierIu(req, _p, url) {
    const { service, chemin } = await controler(req, url);
    const iu = iuDe(url);
    if (iu === IU_TEST) return jsonSigne({ valide: false }, chemin);
    const fiche = (await cfg.identites.piecesDe(iu)).find(p => p.type === "fiche_identite");
    const valide = !!fiche && !/décédé/i.test(fiche.statut || "");
    await cfg.journal.ajouter({ action: "Identité confirmée à la plateforme", casquette: "plateforme", service: service || null, nin: iu,
      resultat: valide ? "réussi" : "inconnu", details: valide ? "nom, prénoms et date de naissance transmis pour connecter le citoyen" : "identifiant non confirmé" });
    return jsonSigne(valide ? { valide: true, nom: fiche.nom, prenoms: fiche.prenoms, date_naissance: fiche.date_naissance } : { valide: false }, chemin);
  }

  async function fichier(_req, p, url) {
    const exp = Number(url.searchParams.get("exp") || 0), sig = url.searchParams.get("sig") || "";
    exiger(exp > horloge() / 1000 && egal(sig, await hmacHex(cfg.cleLiens, `${p.id}\n${exp}`)), 403, "lien invalide ou expiré");
    const r = cfg.registres.find(x => p.id.startsWith(`${x.id}-`));
    const piece = r && await r.stockage.piece(p.id);
    exiger(piece && types.includes(piece.type), 404, "document introuvable");
    const octets = await cfg.lireFichier(r.id, piece.fichier);
    await cfg.journal.ajouter({ action: "Document téléchargé par la plateforme", casquette: "plateforme", nin: piece.nin, registre: r.emetteur, donnee: piece.type, cible: piece.id });
    return new Response(octets, { headers: { "content-type": "application/pdf", "cache-control": "no-store", "content-disposition": `inline; filename="${piece.id}.pdf"` } });
  }

  const gestionnaire = routeur([
    ["GET", "/documents", documents],
    ...(cfg.verification ? [["GET", "/verifier", verifierIu]] : []),
    ["GET", "/catalogue", catalogue],
    ["GET", "/predicat", predicat],
    ["GET", "/lien", lienCourt],
    ["GET", "/fichiers/{id}", fichier],
  ], { prefixe: cfg.prefixe ?? "/api-service" });   // "" : service autonome servi à la racine (ex. Render)
  return { gestionnaire, controler };
}
