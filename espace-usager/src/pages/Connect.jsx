/**
 * Portail de branchement (/connect) : un registre vient avec l'identifiant et le code secret remis par le super admin,
 * lit le contrat d'API, configure et teste ses routes, puis se branche. Le socle lit alors son catalogue et ses règles d'accès.
 */
import { useState } from "react";
import { actualiserCatalogue, brancher, ouvrirSession, passerBanc, testerApi } from "../api/connect.js";
import { BulletinConformite } from "../composants/BulletinConformite.jsx";
import { EnTete, PiedDePage } from "../mise-en-page/EnTete.jsx";
import { PREDICATS, TYPES_DOCUMENT, TYPES_PIECE } from "../noyau/referentiel.js";
import { Bouton } from "../ui/Bouton.jsx";
import { Carte } from "../ui/Carte.jsx";
import { Champ, Coche } from "../ui/Champs.jsx";
import { Alerte } from "../ui/Signaux.jsx";

// ── Exemples du contrat ──────────────────────────────────────────────────────
const EXEMPLE_REPONSE = `[
  {
    "id": "ACT-2025-0042",
    "type": "acte_naissance",
    "titre": "Acte de naissance",
    "date": "2025-06-01",
    "url": "https://votre-service/fichiers/ACT-2025-0042"
  }
]`;

const EXEMPLE_PYTHON = `import hmac, hashlib, time
from fastapi import FastAPI, Request, HTTPException

SECRET = "votre code secret"
app = FastAPI()

def verifier_socle(req: Request):
    ts = req.headers.get("X-Socle-Horodatage", "0")
    chemin = req.url.path + ("?" + req.url.query if req.url.query else "")
    attendu = hmac.new(SECRET.encode(), f"{ts}\\nGET\\n{chemin}".encode(), hashlib.sha256).hexdigest()
    if abs(time.time() - int(ts)) > 300 or not hmac.compare_digest(attendu, req.headers.get("X-Socle-Signature", "")):
        raise HTTPException(401)

@app.get("/documents")
def documents(iu: str, req: Request, types: str = "", demandeur: str = ""):
    verifier_socle(req)
    return [  # vos documents pour cet identifiant unique, limités aux types demandés
        {"id": "ACT-2025-0042", "type": "acte_naissance", "titre": "Acte de naissance", "url": "https://votre-service/fichiers/ACT-2025-0042"}
    ]`;

const EXEMPLE_NODE = `const crypto = require("crypto");
const SECRET = "votre code secret";

function verifierSocle(req, res, next) {
  const ts = req.get("X-Socle-Horodatage") || "0";
  const attendu = crypto.createHmac("sha256", SECRET).update(\`\${ts}\\nGET\\n\${req.originalUrl}\`).digest("hex");
  const recu = req.get("X-Socle-Signature") || "";
  const ok = recu.length === attendu.length && crypto.timingSafeEqual(Buffer.from(recu), Buffer.from(attendu));
  if (!ok || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return res.sendStatus(401);
  next();
}

app.get("/documents", verifierSocle, (req, res) => {
  res.json([/* vos documents pour req.query.iu */]);
});`;

const EXEMPLE_SIGNATURE_PYTHON = `import hashlib, hmac, json, time
from fastapi import Request, Response

def reponse_signee(req: Request, donnees, statut=200) -> Response:
    corps = json.dumps(donnees, ensure_ascii=False).encode()
    ts = str(int(time.time()))
    chemin = req.url.path + ("?" + req.url.query if req.url.query else "")
    message = f"{ts}\\n{chemin}\\n{hashlib.sha256(corps).hexdigest()}"
    signature = hmac.new(SECRET.encode(), message.encode(), hashlib.sha256).hexdigest()
    return Response(corps, status_code=statut, media_type="application/json",
                    headers={"X-Registre-Horodatage": ts, "X-Registre-Signature": signature})`;

const EXEMPLE_SIGNATURE_NODE = `function envoyerSigne(req, res, donnees, statut = 200) {
  const corps = Buffer.from(JSON.stringify(donnees));
  const ts = String(Math.floor(Date.now() / 1000));
  const empreinte = crypto.createHash("sha256").update(corps).digest("hex");
  const signature = crypto.createHmac("sha256", SECRET).update(\`\${ts}\\n\${req.originalUrl}\\n\${empreinte}\`).digest("hex");
  res.status(statut).set({ "Content-Type": "application/json", "X-Registre-Horodatage": ts, "X-Registre-Signature": signature }).send(corps);
}`;

const EXEMPLE_CATALOGUE = `GET https://votre-service/catalogue
→ {
  "types": ["casier_judiciaire"],
  "predicats": ["casier_vierge"],
  "autorisations": {
    "casier_judiciaire": ["direction-des-passeports"],
    "casier_vierge": ["*"]
  }
}`;

const EXEMPLE_PREDICAT = `GET https://votre-service/predicat?iu=…&q=majeur&demandeur=…
→ { "q": "majeur", "reponse": true }      (null si la personne vous est inconnue)`;

const EXEMPLE_LIEN = `GET https://votre-service/lien?iu=…&document=ACT-2025-0042&demandeur=…
→ { "url": "https://votre-service/fichiers/ACT-2025-0042?exp=…&sig=…", "expire": "2026-11-18T10:05:00Z" }`;

const LIB_SIGNATURE = {
  valide: ["ok", "Réponse signée : signature vérifiée par la passerelle."],
  absente: ["att", "Réponse non signée : acceptée pendant la période de transition, mais à signer (section 3)."],
};
function EtatSignature({ signature }) {
  const [ton, texte] = LIB_SIGNATURE[signature] || ["att", "Signature non vérifiée."];
  return <p className={`signature-etat ${ton}`}>{texte}</p>;
}

const Json = ({ valeur }) => <pre>{JSON.stringify(valeur, null, 2)}</pre>;
const Code = ({ children }) => <code>{children}</code>;

function TableEntetes({ lignes }) {
  return (
    <div className="tablewrap">
      <table className="contrat">
        <tbody>
          {lignes.map(([nom, description]) => (
            <tr key={nom}>
              <td>
                <Code>{nom}</Code>
              </td>
              <td>{description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Connexion du service ─────────────────────────────────────────────────────
function ConnexionService({ onEntree }) {
  const [ids, setIds] = useState({ service_id: "", secret: "" });
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const entrer = async (e) => {
    e.preventDefault();
    setEnCours(true);
    const identifiants = { service_id: ids.service_id.trim(), secret: ids.secret.trim() };
    try {
      onEntree(identifiants, await ouvrirSession(identifiants));
    } catch (err) {
      setErreur(err.message);
      setEnCours(false);
    }
  };
  return (
    <>
      <h1 className="titre-page">Brancher votre registre</h1>
      <p className="sous">Saisissez l'identifiant de service et le code secret que vous a remis l'administrateur du socle « Dites-le-nous une fois ».</p>
      <Carte className="etroite-s">
        <form onSubmit={entrer}>
          <Champ label="Identifiant du service" autoComplete="username" value={ids.service_id} onChange={(e) => setIds({ ...ids, service_id: e.target.value })} />
          <Champ label="Code secret" type="password" autoComplete="current-password" value={ids.secret} onChange={(e) => setIds({ ...ids, secret: e.target.value })} />
          <div className="actions">
            <Bouton type="submit" enCours={enCours}>
              Accéder
            </Bouton>
          </div>
        </form>
        {erreur ? <Alerte ton="ko">{erreur}</Alerte> : null}
      </Carte>
    </>
  );
}

// ── Contrat ──────────────────────────────────────────────────────────────────
function Contrat({ doubleApi, iuTest }) {
  return (
    <Carte>
      <h2>1. La route obligatoire : vos documents</h2>
      <p>
        Une route qui reçoit l'<b>identifiant unique</b> d'un citoyen (NIN, 17 chiffres) et renvoie les documents que <b>votre service</b> détient sur
        lui. Vos documents restent chez vous : le socle ne les stocke pas.
      </p>
      <pre>{`GET https://votre-service/documents?iu=${iuTest}&types=acte_naissance&demandeur=…&dossier=…&finalite=…`}</pre>
      <TableEntetes
        lignes={[
          ["iu", "identifiant unique du citoyen"],
          ["types", "types de pièces demandés (séparés par des virgules) : ne renvoyez que ceux-là"],
          ["demandeur", "identifiant du service qui demande (ex. direction-des-passeports) : à vous de l'autoriser ou non"],
          ["dossier", "numéro du dossier, pour votre propre trace"],
          ["finalite", "pourquoi la pièce est demandée"],
        ]}
      />
      <p>Réponse attendue (JSON, liste vide si vous n'avez rien). Répondez 403 si vos règles n'autorisent pas ce demandeur.</p>
      <pre>{EXEMPLE_REPONSE}</pre>
      <div className="tablewrap">
        <table className="contrat">
          <thead>
            <tr>
              <th>Champ</th>
              <th>Obligatoire</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr><td><Code>id</Code></td><td>oui</td><td>Identifiant du document chez vous.</td></tr>
            <tr><td><Code>titre</Code></td><td>oui</td><td>Libellé lisible par l'agent et le citoyen.</td></tr>
            <tr><td><Code>url</Code></td><td>oui</td><td>Lien vers le fichier (PDF ou image), de préférence signé et de courte durée.</td></tr>
            <tr>
              <td><Code>type</Code></td>
              <td>oui</td>
              <td>
                Code du type de pièce, parmi :{" "}
                {TYPES_DOCUMENT.map((t, i) => (
                  <span key={t}>
                    {i ? ", " : ""}
                    <Code>{t}</Code>
                  </span>
                ))}
                .
              </td>
            </tr>
            <tr><td><Code>date</Code></td><td>non</td><td>Date d'émission (AAAA-MM-JJ).</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        L'identifiant de test <Code>{iuTest}</Code> ne correspond à personne : répondez-lui toujours une liste vide, quelles que soient vos règles.
      </p>

      {doubleApi ? (
        <>
          <h2>1 bis. Vérification de l'identifiant unique (registre d'identité)</h2>
          <pre>{`GET https://votre-service/verifier?iu=${iuTest}
→ { "valide": true, "nom": "…", "prenoms": "…" }
→ { "valide": false }`}</pre>
          <p>Le socle ne transmet que le nom et les prénoms à l'agent, pour vérifier la personne en face.</p>
        </>
      ) : null}

      <h2>2. Vérifier que l'appel vient bien du socle</h2>
      <p>
        Chaque appel porte trois en-têtes. Refusez toute requête dont la signature est fausse ou dont l'horodatage a plus de 5 minutes. Le contexte
        (demandeur, dossier, finalité) fait partie de la requête : il est donc couvert par la signature.
      </p>
      <TableEntetes
        lignes={[
          ["X-Socle-Service", "votre identifiant de service"],
          ["X-Socle-Horodatage", "heure de l'appel (secondes Unix)"],
          ["X-Socle-Signature", 'HMAC-SHA256 en hexadécimal, clé = votre code secret, message = horodatage + "\\n" + "GET" + "\\n" + chemin?requête'],
        ]}
      />
      <h3>Python (FastAPI)</h3>
      <pre>{EXEMPLE_PYTHON}</pre>
      <h3>Node.js (Express)</h3>
      <pre>{EXEMPLE_NODE}</pre>

      <h2>3. Signer vos réponses</h2>
      <p>
        L'authentification est mutuelle : signez <b>chaque</b> réponse. Une signature fausse ou périmée fait rejeter la réponse ; une réponse non
        signée est encore acceptée pendant la période de transition, mais marquée comme telle dans le journal.
      </p>
      <TableEntetes
        lignes={[
          ["X-Registre-Horodatage", "heure de la réponse (secondes Unix)"],
          ["X-Registre-Signature", 'HMAC-SHA256, clé = votre code secret, message = horodatage + "\\n" + chemin?requête reçu + "\\n" + SHA-256 du corps'],
        ]}
      />
      <h3>Python (FastAPI)</h3>
      <pre>{EXEMPLE_SIGNATURE_PYTHON}</pre>
      <h3>Node.js (Express)</h3>
      <pre>{EXEMPLE_SIGNATURE_NODE}</pre>

      <h2>4. Routes recommandées</h2>
      <h3>/catalogue : ce que vous proposez, et à qui</h3>
      <p>
        Vous décidez quels services peuvent vous demander quoi (<Code>"*"</Code> = tous). La passerelle respecte ces règles : elle n'envoie même pas le
        NIN à un registre qui refuserait.
      </p>
      <pre>{EXEMPLE_CATALOGUE}</pre>
      <h3>/predicat : répondre oui ou non sans transmettre la donnée</h3>
      <p>
        Réponses minimales prévues :{" "}
        {PREDICATS.map((p, i) => (
          <span key={p}>
            {i ? ", " : ""}
            <Code>{p}</Code>
          </span>
        ))}
        . Exemple : « majeur » sans transmettre la date de naissance.
      </p>
      <pre>{EXEMPLE_PREDICAT}</pre>
      <h3>/lien : un lien court, redemandé à chaque consultation</h3>
      <p>Le fichier ne passe pas par le socle : l'agent l'ouvre directement chez vous, avec un lien signé valable quelques minutes.</p>
      <pre>{EXEMPLE_LIEN}</pre>
    </Carte>
  );
}

// ── Configuration ────────────────────────────────────────────────────────────
const ROUTES = [
  ["documents", "Route documents (obligatoire)", "https://votre-service/documents"],
  ["verifier", "Route de vérification (double API)", "https://votre-service/verifier"],
  ["catalogue", "Route catalogue", "https://votre-service/catalogue"],
  ["predicat", "Route des réponses minimales", "https://votre-service/predicat"],
  ["lien", "Route des liens courts", "https://votre-service/lien"],
];

function adaptateurInitial(a) {
  return {
    parametre_iu: a?.parametre_iu || "",
    liste: a?.liste || "",
    champs: { id: "", type: "", titre: "", url: "", date: "", ...(a?.champs || {}) },
    types: Object.entries(a?.types || {}).map(([k, v]) => `${k} = ${v}`).join("\n"),
    verifier: { valide: "", nom: "", prenoms: "", ...(a?.verifier || {}) },
    verifier_presence: Boolean(a?.verifier_presence),
    calculs: Object.fromEntries(Object.keys(CALCULS).map((q) => [q, { url: a?.calculs?.[q]?.url || "", champ: a?.calculs?.[q]?.champ || "" }])),
  };
}
function adaptateurAEnvoyer(a) {
  const types = Object.fromEntries(
    a.types
      .split("\n")
      .map((l) => l.split("=").map((x) => x.trim()))
      .filter(([k, v]) => k && v),
  );
  const calculs = Object.fromEntries(Object.entries(a.calculs).filter(([, c]) => c.url.trim() && c.champ.trim()));
  return { parametre_iu: a.parametre_iu, liste: a.liste, champs: a.champs, types, verifier: a.verifier, verifier_presence: a.verifier_presence, calculs };
}

/** Réponses oui/non que le socle sait calculer quand le registre ne les propose pas (il ne garde que la réponse). */
const CALCULS = {
  majeur: { libelle: "Majeur : oui/non", source: "date de naissance", url: "https://votre-service/personnes/{iu}", champ: "ex. data.date_naissance" },
  casier_vierge: { libelle: "Casier judiciaire vierge : oui/non", source: "mentions du casier", url: "https://votre-service/casier", champ: "ex. mentions" },
};

function ResultatTest({ resultat }) {
  if (!resultat || resultat.enCours) return null;
  return resultat.ok ? (
    <Alerte ton="ok">
      <b>{resultat.titre || "Test réussi."}</b>
      {resultat.reponse !== undefined ? <Json valeur={resultat.reponse} /> : null}
      {resultat.signature ? <EtatSignature signature={resultat.signature} /> : null}
    </Alerte>
  ) : (
    <Alerte ton="ko">{resultat.msg}</Alerte>
  );
}

function Configuration({ ids, infos, onCatalogue, onConnexion }) {
  const c = infos.connexion || {};
  const [urls, setUrls] = useState(Object.fromEntries(ROUTES.map(([r]) => [r, c[`url_${r}`] || ""])));
  const [adaptateur, setAdaptateur] = useState(adaptateurInitial(infos.adaptateur));
  const [declare, setDeclare] = useState({ types: infos.catalogue?.source === "declaration" ? infos.catalogue.types : [], predicats: [] });
  const [q, setQ] = useState(PREDICATS[0]);
  const [tests, setTests] = useState({});
  const [resultat, setResultat] = useState(null);
  const [banc, setBanc] = useState(null);
  const [essais, setEssais] = useState({});
  const routes = ROUTES.filter(([r]) => r !== "verifier" || infos.double_api);

  /** À partir de …/documents, propose …/catalogue, …/predicat et …/lien. */
  const deduire = () => {
    const base = urls.documents.trim().replace(/\/documents\/?$/, "");
    if (!base || base === urls.documents.trim()) return;
    setUrls((u) => Object.fromEntries(Object.entries(u).map(([r, v]) => [r, v || (r === "verifier" && !infos.double_api ? "" : `${base}/${r}`)])));
  };
  const tester = async (quoi) => {
    if (!urls[quoi].trim()) return setTests((t) => ({ ...t, [quoi]: { ok: false, msg: "Indiquez l'URL." } }));
    setTests((t) => ({ ...t, [quoi]: { enCours: true } }));
    try {
      const r = await testerApi(ids, { quoi, url: urls[quoi].trim(), q, adaptateur: adaptateurAEnvoyer(adaptateur) });
      setTests((t) => ({ ...t, [quoi]: { ok: true, reponse: r.reponse, signature: r.signature } }));
    } catch (e) {
      setTests((t) => ({ ...t, [quoi]: { ok: false, msg: e.message } }));
    }
  };
  const brancherRegistre = async () => {
    setResultat({ enCours: true });
    try {
      const r = await brancher(ids, {
        ...Object.fromEntries(routes.map(([rt]) => [`url_${rt}`, urls[rt].trim() || null])),
        adaptateur: adaptateurAEnvoyer(adaptateur),
        catalogue_declare: declare,
      });
      setResultat({ ok: true, titre: r.message, reponse: r.reponse_test, signature: r.signature });
      onCatalogue(r.catalogue);
      onConnexion((await ouvrirSession(ids)).connexion);
    } catch (e) {
      setResultat({ ok: false, msg: e.message });
    }
  };
  /** Teste un calcul (majeur, casier vierge) sur une personne connue : seule la réponse oui/non s'affiche, jamais la donnée. */
  const testerCalcul = async (q) => {
    const c = adaptateur.calculs[q];
    if (!c.url.trim() || !c.champ.trim()) return setTests((t) => ({ ...t, [`calcul-${q}`]: { ok: false, msg: "Indiquez l'adresse et le champ." } }));
    setTests((t) => ({ ...t, [`calcul-${q}`]: { enCours: true } }));
    try {
      const r = await testerApi(ids, { quoi: "calcul", q, url: c.url.trim(), adaptateur: adaptateurAEnvoyer(adaptateur), iu_essai: essais[q] || "" });
      setTests((t) => ({ ...t, [`calcul-${q}`]: { ok: true, titre: `${CALCULS[q].libelle} : ${r.reponse.reponse}`, signature: r.signature } }));
    } catch (e) {
      setTests((t) => ({ ...t, [`calcul-${q}`]: { ok: false, msg: e.message } }));
    }
  };

  const passerAuBanc = async () => {
    if (!urls.documents.trim()) return setBanc({ erreur: "Indiquez au moins l'URL de la route /documents." });
    setBanc({ enCours: true });
    try {
      const u = Object.fromEntries(routes.filter(([rt]) => rt !== "lien").map(([rt]) => [`url_${rt}`, urls[rt].trim() || null]));
      setBanc({ resultat: await passerBanc(ids, u, adaptateurAEnvoyer(adaptateur)) });
    } catch (e) {
      setBanc({ erreur: e.message });
    }
  };
  const champ = (groupe, cle) => (e) => setAdaptateur((a) => ({ ...a, [groupe]: { ...a[groupe], [cle]: e.target.value } }));
  const basculer = (liste, code) => setDeclare((d) => ({ ...d, [liste]: d[liste].includes(code) ? d[liste].filter((x) => x !== code) : [...d[liste], code] }));

  return (
    <Carte>
      <h2>5. Configurer, tester et brancher</h2>
      <p>
        Le socle appelle vos routes avec l'identifiant de test <Code>{infos.socle_identifiant_test}</Code>. Après la route documents, les autres
        adresses sont proposées automatiquement.
      </p>
      {routes.map(([r, libelle, exemple]) => (
        <div key={r} className="route-config">
          <Champ
            label={libelle}
            placeholder={exemple}
            value={urls[r]}
            onChange={(e) => setUrls({ ...urls, [r]: e.target.value })}
            onBlur={r === "documents" ? deduire : undefined}
          />
          {r !== "lien" ? (
            <div className="actions">
              {r === "predicat" ? (
                <select className="choix-q" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Réponse à tester">
                  {PREDICATS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              ) : null}
              <Bouton variante="second" petit onClick={() => tester(r)} enCours={tests[r]?.enCours}>
                Tester
              </Bouton>
            </div>
          ) : (
            <p className="sous resume">Testée à la première consultation d'une pièce.</p>
          )}
          <ResultatTest resultat={tests[r]} />
        </div>
      ))}

      <details className="pliable">
        <summary>Adaptateur : votre API ne suit pas exactement ce contrat ?</summary>
        <p className="sous">
          Pour brancher un système existant ou le registre d'une autre équipe, indiquez comment traduire ses réponses. Laissez vide ce qui suit déjà
          le contrat.
        </p>
        <div className="ligne2">
          <div>
            <Champ label="Nom du paramètre portant le NIN" placeholder="iu" value={adaptateur.parametre_iu} onChange={(e) => setAdaptateur({ ...adaptateur, parametre_iu: e.target.value })} />
          </div>
          <div>
            <Champ label="Chemin de la liste dans la réponse" placeholder="ex. data.items" value={adaptateur.liste} onChange={(e) => setAdaptateur({ ...adaptateur, liste: e.target.value })} />
          </div>
        </div>
        <label>Correspondance des champs (nom du champ chez vous)</label>
        <div className="grille-adaptateur">
          {["id", "type", "titre", "url", "date"].map((k) => (
            <input key={k} type="text" placeholder={k} aria-label={`Champ ${k}`} value={adaptateur.champs[k]} onChange={champ("champs", k)} />
          ))}
        </div>
        <label htmlFor="adapt-types">Correspondance des types (une par ligne : valeur chez vous = code du socle)</label>
        <textarea
          id="adapt-types"
          rows={3}
          placeholder={"NAISSANCE = acte_naissance\nCASIER_B3 = casier_judiciaire"}
          value={adaptateur.types}
          onChange={(e) => setAdaptateur({ ...adaptateur, types: e.target.value })}
        />
        {infos.double_api ? (
          <>
            <label>Vérification d'identité (nom du champ chez vous ; « data.nom » pour un champ imbriqué)</label>
            <div className="grille-adaptateur">
              {["valide", "nom", "prenoms"].map((k) => (
                <input key={k} type="text" placeholder={k} aria-label={`Champ ${k}`} value={adaptateur.verifier[k]} onChange={champ("verifier", k)}
                  disabled={k === "valide" && adaptateur.verifier_presence} />
              ))}
            </div>
            <Coche checked={adaptateur.verifier_presence} onChange={(e) => setAdaptateur({ ...adaptateur, verifier_presence: e.target.checked })}>
              La personne est reconnue dès que sa fiche existe (pas de champ « valide » ; une erreur 404 veut dire « inconnue »)
            </Coche>
          </>
        ) : null}

        <label>Réponses oui/non calculées par le socle</label>
        <p className="sous">
          Votre registre ne répond pas « majeur : oui/non » mais donne la fiche de la personne ? Indiquez l'adresse de cette fiche
          (« {"{iu}"} » est remplacé par le code unique) et le champ de la donnée. Le socle lit la donnée, calcule oui/non, et l'oublie :
          elle n'est ni transmise au service, ni conservée, ni inscrite au journal.
        </p>
        {Object.entries(CALCULS).map(([q, c]) => (
          <div key={q} className="calcul">
            <b>{c.libelle}</b> <small className="sous">à partir de la {c.source}</small>
            <div className="ligne2">
              <div>
                <Champ label="Adresse de la fiche" placeholder={c.url} value={adaptateur.calculs[q].url}
                  onChange={(e) => setAdaptateur({ ...adaptateur, calculs: { ...adaptateur.calculs, [q]: { ...adaptateur.calculs[q], url: e.target.value } } })} />
              </div>
              <div>
                <Champ label="Champ de la donnée" placeholder={c.champ} value={adaptateur.calculs[q].champ}
                  onChange={(e) => setAdaptateur({ ...adaptateur, calculs: { ...adaptateur.calculs, [q]: { ...adaptateur.calculs[q], champ: e.target.value } } })} />
              </div>
            </div>
            <div className="actions">
              <input type="text" inputMode="numeric" maxLength={17} placeholder="Code unique d'une personne connue" aria-label="Code unique d'essai"
                value={essais[q] || ""} onChange={(e) => setEssais({ ...essais, [q]: e.target.value })} />
              <Bouton variante="second" petit onClick={() => testerCalcul(q)} enCours={tests[`calcul-${q}`]?.enCours}>
                Tester le calcul
              </Bouton>
            </div>
            <ResultatTest resultat={tests[`calcul-${q}`]} />
          </div>
        ))}
      </details>

      <details className="pliable">
        <summary>Pas de route /catalogue ? Déclarez les pièces que vous détenez</summary>
        <p className="sous">Sans catalogue, la passerelle ne sait pas quelles pièces vous demander. Vos règles d'accès seront alors « tous les services ».</p>
        <div className="grille-pieces">
          {TYPES_DOCUMENT.map((t) => (
            <Coche key={t} checked={declare.types.includes(t)} onChange={() => basculer("types", t)}>
              {TYPES_PIECE[t]}
            </Coche>
          ))}
        </div>
      </details>

      <hr />
      <div className="actions">
        <Bouton onClick={brancherRegistre} enCours={resultat?.enCours}>
          Brancher mon registre
        </Bouton>
        <Bouton variante="second" onClick={passerAuBanc} enCours={banc?.enCours}>
          Passer le banc de conformité
        </Bouton>
      </div>
      <ResultatTest resultat={resultat} />
      <p className="sous">
        Le banc vérifie, sans rien brancher, que votre registre respecte le contrat : réponses signées, appels non signés, mal signés ou périmés
        refusés, règles d'accès appliquées, réponses oui/non sans la donnée source. Chaque passage est inscrit au journal.
      </p>
      {banc?.erreur ? <Alerte ton="ko">{banc.erreur}</Alerte> : null}
      <BulletinConformite resultat={banc?.resultat} />
    </Carte>
  );
}

function CatalogueActuel({ ids, catalogue, connexion, onCatalogue }) {
  const [message, setMessage] = useState(null);
  const relire = async () => {
    try {
      onCatalogue(await actualiserCatalogue(ids));
      setMessage({ ok: true, msg: "Catalogue relu." });
    } catch (e) {
      setMessage({ ok: false, msg: e.message });
    }
  };
  const codes = [...(catalogue?.types || []), ...(catalogue?.predicats || [])];
  return (
    <Carte>
      <h2>6. Votre catalogue et vos règles d'accès</h2>
      {codes.length ? (
        <>
          <p className="sous">
            {catalogue.source === "registre" ? "Lu sur votre route /catalogue" : "Déclaré manuellement"} le {catalogue.le?.replace("T", " à ")}.
          </p>
          <div className="tablewrap">
            <table className="contrat">
              <thead>
                <tr>
                  <th>Pièce ou réponse</th>
                  <th>Services autorisés</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((code) => {
                  const regle = catalogue.autorisations?.[code] || catalogue.autorisations?.["*"] || ["*"];
                  return (
                    <tr key={code}>
                      <td>{TYPES_PIECE[code] || code}</td>
                      <td>{regle.includes("*") ? "Tous les services" : regle.join(", ")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="vide">Aucun catalogue pour l'instant : branchez votre registre (section 5).</p>
      )}
      {connexion?.url_catalogue ? (
        <div className="actions">
          <Bouton variante="second" petit onClick={relire}>
            Relire mon catalogue
          </Bouton>
        </div>
      ) : null}
      {message ? <Alerte ton={message.ok ? "ok" : "ko"}>{message.msg}</Alerte> : null}
    </Carte>
  );
}

function EspaceService({ ids, infos, onSortir }) {
  const [connexion, setConnexion] = useState(infos.connexion);
  const [catalogue, setCatalogue] = useState(infos.catalogue);
  return (
    <>
      <div className="entete-page">
        <div>
          <h1 className="titre-page">
            {infos.nom}
            {infos.double_api ? " — double API" : ""}
          </h1>
          <p className="sous">
            {connexion ? `Branché le ${connexion.branche_le.replace("T", " à ")} — ${connexion.url_documents}` : "Pas encore branché."}
          </p>
        </div>
        <Bouton variante="second" onClick={onSortir}>
          Se déconnecter
        </Bouton>
      </div>
      <Contrat doubleApi={infos.double_api} iuTest={infos.socle_identifiant_test} />
      <Configuration ids={ids} infos={{ ...infos, connexion }} onCatalogue={setCatalogue} onConnexion={setConnexion} />
      <CatalogueActuel ids={ids} catalogue={catalogue} connexion={connexion} onCatalogue={setCatalogue} />
    </>
  );
}

export function Connect() {
  const [session, setSession] = useState(null);
  return (
    <>
      <EnTete sousTitre="Branchement des registres" />
      <main className="sans-menu page-connect">
        <section className="contenu">
          {session ? (
            <EspaceService ids={session.ids} infos={session.infos} onSortir={() => setSession(null)} />
          ) : (
            <ConnexionService onEntree={(ids, infos) => setSession({ ids, infos })} />
          )}
        </section>
      </main>
      <PiedDePage />
    </>
  );
}
