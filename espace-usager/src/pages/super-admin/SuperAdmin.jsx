/** Espace super admin : services (et leurs codes de branchement), admins, super admins, journal global. */
import { useEffect, useState } from "react";
import { listeBranchements } from "../../api/connect.js";
import { useSocle } from "../../donnees/hooks.js";
import { useEspace } from "../../mise-en-page/espace.js";
import { basculerService, creerService, modifierService, regenererCode, supprimerService } from "../../metier/administrations.js";
import { controlerJournal, falsifierUneLigne } from "../../metier/journal.js";
import { ficheBranchementPdf, telecharger } from "../../noyau/fiche-pdf.js";
import { TYPES_PIECE, TYPES_SERVICE } from "../../noyau/referentiel.js";
import { nomService } from "../../noyau/selecteurs.js";
import { FormNomination, TableRoles } from "../../composants/Roles.jsx";
import { TableJournal } from "../../composants/TableJournal.jsx";
import { Bouton } from "../../ui/Bouton.jsx";
import { Carte, EnTetePage, Vide } from "../../ui/Carte.jsx";
import { Champ, Selection } from "../../ui/Champs.jsx";
import { Modale } from "../../ui/Modale.jsx";
import { AucunResultat, BarreRecherche, useRecherche } from "../../ui/Recherche.jsx";
import { Alerte, Pastille } from "../../ui/Signaux.jsx";
import { Mono, Tableau } from "../../ui/Tableau.jsx";
import { useToast } from "../../ui/Toasts.jsx";

// ── Services ─────────────────────────────────────────────────────────────────
/** Code secret à remettre au service : montré une seule fois, à copier ou à télécharger en fiche PDF. */
function CodeBranchement({ code, par }) {
  const toast = useToast();
  const url = `${location.origin}/frontend/connect`;
  const copier = async () => {
    try {
      await navigator.clipboard.writeText(code.secret);
      toast("Code secret copié.");
    } catch {
      toast("Copie impossible : sélectionnez le code et copiez-le à la main.");
    }
  };
  const pdf = () => {
    telecharger(ficheBranchementPdf({ nom: code.nom, id: code.id, secret: code.secret, url, par }), `branchement-${code.id}.pdf`);
    toast("Fiche de branchement téléchargée.");
  };
  return (
    <div className="code-branchement">
      <p className="code-unique">
        ⚠️ <b>Ce code ne s'affiche qu'une seule fois.</b> Copiez-le ou téléchargez la fiche PDF maintenant : une fois cette page
        quittée, il faudra générer un nouveau code.
      </p>
      À remettre au service :
      <dl>
        <dt>Identifiant</dt>
        <dd className="mono">{code.id}</dd>
        <dt>Code secret</dt>
        <dd className="mono">{code.secret}</dd>
        <dt>Page de branchement</dt>
        <dd className="mono">{url}</dd>
      </dl>
      <div className="code-actions">
        <Bouton petit onClick={pdf}>⬇ Télécharger la fiche (PDF)</Bouton>
        <Bouton petit variante="second" onClick={copier}>Copier le code</Bouton>
      </div>
    </div>
  );
}

const SERVICE_VIDE = { nom: "", sigle: "", type: "ministere", tutelle: "", ville: "", double_api: false };

/** Catalogue publié par le registre lors de son branchement (lecture seule : c'est le registre qui décide). */
function CatalogueRegistre({ fiche }) {
  if (!fiche?.branche) return <small className="sous">non branché</small>;
  const codes = [...(fiche.types || []), ...(fiche.predicats || [])];
  if (!codes.length) return <small className="sous">catalogue non déclaré</small>;
  const restreints = codes.filter((c) => !(fiche.autorisations?.[c] || fiche.autorisations?.["*"] || ["*"]).includes("*"));
  return (
    <small>
      {codes.map((c) => TYPES_PIECE[c] || c).join(", ")}
      {restreints.length ? (
        <>
          <br />
          <Pastille ton="att">accès restreint : {restreints.map((c) => TYPES_PIECE[c] || c).join(", ")}</Pastille>
        </>
      ) : null}
    </small>
  );
}

/** Champs d'un service, communs à la création et à la modification. */
function ChampsService({ f, champ, ministeres }) {
  return (
    <>
      <div className="ligne2">
        <div>
          <Champ label="Nom" placeholder="Ministère de la Fonction publique" value={f.nom} onChange={champ("nom")} />
        </div>
        <div>
          <Champ label="Sigle" placeholder="MFP" value={f.sigle} onChange={champ("sigle")} />
        </div>
      </div>
      <div className="ligne2">
        <div>
          <Selection label="Type" value={f.type} onChange={champ("type")} options={Object.entries(TYPES_SERVICE)} />
        </div>
        <div>
          <Selection
            label="Ministère de tutelle"
            value={f.tutelle}
            onChange={champ("tutelle")}
            options={[["", "— Aucun —"], ...ministeres.map(([id, s]) => [id, s.nom])]}
          />
        </div>
      </div>
      <Champ label="Ville" placeholder="Ouagadougou" value={f.ville} onChange={champ("ville")} />
    </>
  );
}

/** Modifier un service : l'identifiant, le code et le branchement ne changent pas. */
function ModaleService({ id, service, onFermer }) {
  const etat = useSocle();
  const { role } = useEspace();
  const toast = useToast();
  const [f, setF] = useState({ nom: service.nom || "", sigle: service.sigle || "", type: service.type || "ministere", tutelle: service.tutelle || "", ville: service.ville || "" });
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const ministeres = Object.entries(etat.services).filter(([k, s]) => s.type === "ministere" && k !== id);
  const champ = (cle) => (e) => setF({ ...f, [cle]: e.target.value });
  const valider = async (e) => {
    e.preventDefault();
    setEnCours(true);
    const r = await modifierService(role, id, f);
    setEnCours(false);
    if (r.ok) {
      toast(r.msg);
      onFermer();
    } else setErreur(r.msg);
  };
  return (
    <Modale titre={`Modifier — ${service.nom}`} onFermer={onFermer}>
      <form onSubmit={valider}>
        <ChampsService f={f} champ={champ} ministeres={ministeres} />
        <p className="sous">
          Identifiant <span className="mono">{id}</span>{service.double_api ? " · double API" : ""} : il ne change pas, le service reste branché avec le même code.
        </p>
        <div className="actions">
          <Bouton type="submit" enCours={enCours}>
            Enregistrer
          </Bouton>
          <Bouton variante="second" onClick={onFermer}>
            Annuler
          </Bouton>
        </div>
      </form>
      {erreur ? <Alerte ton="ko">{erreur}</Alerte> : null}
    </Modale>
  );
}

function FormService({ onCode }) {
  const etat = useSocle();
  const { role } = useEspace();
  const [f, setF] = useState(SERVICE_VIDE);
  const [enCours, setEnCours] = useState(false);
  const ministeres = Object.entries(etat.services).filter(([, s]) => s.type === "ministere");
  const champ = (cle) => (e) => setF({ ...f, [cle]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  const valider = async (e) => {
    e.preventDefault();
    setEnCours(true);
    const r = await creerService(role, f);
    setEnCours(false);
    onCode(r.ok ? { ...r, titre: `Service « ${r.nom} » créé${f.double_api ? " (double API)" : ""}.`, suite: "Nommez ensuite son admin dans « Admins des services »." } : r);
    if (r.ok) setF(SERVICE_VIDE);
  };

  return (
    <Carte titre="Créer un service" className="moyenne">
      <form onSubmit={valider}>
        <ChampsService f={f} champ={champ} ministeres={ministeres} />
        <label className="coche option">
          <input type="checkbox" checked={f.double_api} onChange={champ("double_api")} />
          <span>
            <b>Double API</b> : en plus de ses documents, ce service détient le registre d'identité et vérifie l'identifiant unique
          </span>
        </label>
        <div className="actions">
          <Bouton type="submit" enCours={enCours}>
            Créer le service
          </Bouton>
        </div>
      </form>
    </Carte>
  );
}

export function Services() {
  const etat = useSocle();
  const { role } = useEspace();
  const [code, setCode] = useState(null);
  const [edition, setEdition] = useState(null);
  const [annuaire, setAnnuaire] = useState({});
  const services = Object.entries(etat.services);
  const recherche = useRecherche(services, ([id, s]) => [s.nom, s.sigle, id, TYPES_SERVICE[s.type], s.ville, s.tutelle && nomService(etat, s.tutelle),
    s.statut === "actif" ? "actif" : "désactivé", s.double_api && "double API", annuaire[id]?.branche ? "branché" : "non branché",
    [...(annuaire[id]?.types || []), ...(annuaire[id]?.predicats || [])].map((c) => TYPES_PIECE[c] || c)]);
  useEffect(() => {
    listeBranchements().then(setAnnuaire, () => setAnnuaire({}));
  }, []);

  const toast = useToast();
  const supprimer = async (id, nom) => {
    if (!confirm(`Supprimer « ${nom} » ?\n\nSon code ne marchera plus, ses admins et agents seront révoqués et ses démarches retirées. `
      + "Les dossiers et le journal sont conservés.\n\nCette action est définitive.")) return;
    const r = await supprimerService(id);
    toast(r.msg);
  };

  const nouveauCode = async (id) => {
    if (!confirm("Générer un nouveau code ? L'ancien ne marchera plus et le service devra se rebrancher.")) return;
    const r = await regenererCode(role, id);
    setCode(r.ok ? { ...r, titre: `Nouveau code pour « ${r.nom} ».` } : r);
  };

  return (
    <>
      <EnTetePage titre="Services">
        Les services sont les administrations qui utilisent le portail : ministères, directions, établissements publics, mairies, tribunaux. Le super
        admin les crée et les définit.
      </EnTetePage>
      <FormService onCode={setCode} />
      {code ? (
        code.ok ? (
          <Alerte ton="ok">
            {code.titre}
            <CodeBranchement code={code} par={role?.code} />
            {code.suite}
          </Alerte>
        ) : (
          <Alerte ton="ko">{code.msg}</Alerte>
        )
      ) : null}
      <Carte>
        {services.length ? (
          <>
          <BarreRecherche recherche={recherche} total={services.length} placeholder="Rechercher : nom, sigle, ville, pièce, branché…" />
          <Tableau entetes={["Service", "Type", "Catalogue (déclaré par le registre)", "Ville", "Statut", "Branchement", ""]}>
            {recherche.resultats.map(([id, s]) => (
              <tr key={id}>
                <td>
                  <b>{s.nom}</b> {s.sigle ? <Mono>({s.sigle})</Mono> : null}
                </td>
                <td>
                  {TYPES_SERVICE[s.type] || s.type}
                  {s.tutelle ? (
                    <>
                      <br />
                      <small className="sous">tutelle : {nomService(etat, s.tutelle)}</small>
                    </>
                  ) : null}
                </td>
                <td>
                  <CatalogueRegistre fiche={annuaire[id]} />
                </td>
                <td>{s.ville || "—"}</td>
                <td>{s.statut === "actif" ? <Pastille ton="ok">actif</Pastille> : <Pastille ton="ko">désactivé</Pastille>}</td>
                <td className="cellule-actions">
                  {s.double_api ? <Pastille ton="info">double API</Pastille> : null}
                  <Bouton variante="second" petit onClick={() => nouveauCode(id)}>
                    Nouveau code
                  </Bouton>
                </td>
                <td className="cellule-actions">
                  <Bouton variante="second" petit onClick={() => setEdition(id)}>
                    Modifier
                  </Bouton>
                  <Bouton variante={s.statut === "actif" ? "danger" : "second"} petit onClick={() => basculerService(role, id)}>
                    {s.statut === "actif" ? "Désactiver" : "Réactiver"}
                  </Bouton>
                  <Bouton variante="danger" petit onClick={() => supprimer(id, s.nom)}>
                    Supprimer
                  </Bouton>
                </td>
              </tr>
            ))}
            {recherche.resultats.length ? null : <AucunResultat colonnes={7} recherche={recherche} />}
          </Tableau>
          </>
        ) : (
          <Vide>Aucun service.</Vide>
        )}
      </Carte>
      {edition && etat.services[edition] ? <ModaleService id={edition} service={etat.services[edition]} onFermer={() => setEdition(null)} /> : null}
    </>
  );
}

// ── Admins et super admins ───────────────────────────────────────────────────
export function Admins() {
  const etat = useSocle();
  const services = Object.entries(etat.services)
    .filter(([, s]) => s.statut === "actif")
    .map(([id, s]) => [id, s.nom]);
  return (
    <>
      <EnTetePage titre="Admins des services">Le super admin nomme un admin par service, en le recherchant par son identifiant unique.</EnTetePage>
      {services.length ? (
        <FormNomination
          titre="Nommer un admin"
          role="admin"
          services={services}
          succes={(code) => `Admin ${code} nommé. Il peut ouvrir l'espace admin de service.`}
        />
      ) : (
        <Carte titre="Nommer un admin" etroite>
          <Vide>Créez d'abord un service.</Vide>
        </Carte>
      )}
      <TableRoles roles={etat.roles.filter((x) => x.role === "admin")} avecService />
    </>
  );
}

export function SuperAdmins() {
  const etat = useSocle();
  return (
    <>
      <EnTetePage titre="Super admins">Le super admin nomme les autres super admins. Il doit toujours en rester au moins un.</EnTetePage>
      <FormNomination role="super_admin" succes={(code) => `${code} nommé.`} />
      <TableRoles roles={etat.roles.filter((x) => x.role === "super_admin")} />
    </>
  );
}

// ── Journal global ───────────────────────────────────────────────────────────
export function JournalGlobal() {
  const etat = useSocle();
  const toast = useToast();
  const [integrite, setIntegrite] = useState(null);

  const verifier = async () => {
    const r = await controlerJournal();
    setIntegrite(
      r.ok
        ? { ok: true, msg: `Journal intègre : ${r.total} lignes, chaîne et sceau vérifiés par le serveur.` }
        : { ok: false, msg: r.ligne ? `Falsification détectée à la ligne n° ${r.ligne} (${r.raison}).` : r.raison },
    );
  };
  const falsifier = async () => {
    const id = await falsifierUneLigne();
    setIntegrite(null);
    toast(id ? `Ligne ${id} modifiée directement en base. Vérifiez l'intégrité.` : "Falsification impossible (journal vide ou démo désactivée).");
  };

  return (
    <>
      <EnTetePage titre="Journal global">
        Journal unique, tenu par le serveur : en ajout seul, chaîné par SHA-256 et scellé. Les échanges avec les registres y sont inscrits par la passerelle
        elle-même.
      </EnTetePage>
      <Carte>
        <div className="actions sans-marge">
          <Bouton onClick={verifier}>Vérifier l'intégrité</Bouton>
          <Bouton variante="danger" onClick={falsifier}>
            Falsifier une ligne (démo)
          </Bouton>
        </div>
        {integrite ? <Alerte ton={integrite.ok ? "ok" : "ko"}>{integrite.ok ? integrite.msg : <b>{integrite.msg}</b>}</Alerte> : null}
      </Carte>
      <TableJournal lignes={[...etat.journal].reverse()} avecEmpreinte />
    </>
  );
}
