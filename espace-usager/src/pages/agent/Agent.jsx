/** Guichet agent : identité, démarche, contrôles de la passerelle, ouverture, suivi, consultation, clôture. */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSocle } from "../../donnees/hooks.js";
import { useEspace } from "../../mise-en-page/espace.js";
import { annuaireRegistres, registresPour } from "../../metier/annuaire.js";
import { cloreDossier, consulterPiece, controlerAcces, controlesOuverture, creerDossier, estExpire, motifRefus, relancerRecherche } from "../../metier/dossiers.js";
import { RegistreInjoignable, verifierIdentite } from "../../metier/identite.js";
import { resumeBilan } from "../../metier/recherche.js";
import { avancement, estFinal } from "../../noyau/dossiers.js";
import { dateFr, jourFr } from "../../noyau/format.js";
import { normaliserIu } from "../../noyau/identite.js";
import { STATUT_DOSSIER, STATUT_PIECE, TYPES_PIECE, estPredicat } from "../../noyau/referentiel.js";
import { consentementActif, dossiersDuService, enAttenteAccord, nomDe, nomService, piecesDe } from "../../noyau/selecteurs.js";
import { Visionneuse } from "../../composants/Visionneuse.jsx";
import { Bouton } from "../../ui/Bouton.jsx";
import { Carte, EnTetePage, Vide } from "../../ui/Carte.jsx";
import { Selection } from "../../ui/Champs.jsx";
import { AucunResultat, BarreRecherche, useRecherche } from "../../ui/Recherche.jsx";
import { Alerte, Pastille, Retour, StatutDossier, StatutPiece } from "../../ui/Signaux.jsx";
import { Mono, Tableau } from "../../ui/Tableau.jsx";
import { useToast } from "../../ui/Toasts.jsx";
import { DonneesTest } from "../../ui/DonneesTest.jsx";

/** Registre(s) auprès duquel une pièce ou une réponse sera demandée, tel qu'affiché au guichet. */
function registreSource(etat, annuaire, type, demandeur) {
  if (annuaire === undefined) return "…";
  if (annuaire === null) return "Passerelle injoignable";
  const { ids, refuses, declare } = registresPour(annuaire, type, demandeur);
  const noms = (liste) => liste.map((id) => annuaire[id]?.nom || nomService(etat, id)).join(", ");
  const refus = refuses.length ? ` · refusée par ${noms(refuses)} (votre service n'y est pas autorisé)` : "";
  if (!ids.length) {
    if (refuses.length) return `Refusée par ${noms(refuses)} (votre service n'y est pas autorisé)${estPredicat(type) ? "" : " : le citoyen la chargera"}`;
    return estPredicat(type) ? "Aucun registre branché ne fournit cette réponse" : "Aucun registre ne la propose : le citoyen la chargera";
  }
  if (estPredicat(type)) return `${noms(ids)} — répond oui ou non, sans transmettre la donnée${refus}`;
  return (declare ? noms(ids) : `Registres sans catalogue déclaré : ${noms(ids)}`) + refus;
}

const Etape = ({ n, titre, children }) => (
  <div className="etape">
    <div className="etape-titre">
      <span className="etape-n">{n}</span>
      {titre}
    </div>
    {children}
  </div>
);

// ── Nouveau dossier ──────────────────────────────────────────────────────────
export function NouveauDossier() {
  const etat = useSocle();
  const { role } = useEspace();
  const navigate = useNavigate();
  const toast = useToast();
  const demarches = Object.entries(etat.demarches[role.service] || {}).filter(([, d]) => d.statut === "active");
  const [demarcheId, setDemarcheId] = useState(demarches[0]?.[0] || "");
  const [iu, setIu] = useState("");
  const [titulaire, setTitulaire] = useState(null);
  const [resultat, setResultat] = useState(null);
  const [enCours, setEnCours] = useState(null);
  const [annuaire, setAnnuaire] = useState(undefined);

  useEffect(() => {
    let actif = true;
    annuaireRegistres(etat).then((a) => actif && setAnnuaire(a));
    return () => void (actif = false);
    // Les branchements sont lus une fois à l'ouverture de l'écran.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!demarches.length)
    return (
      <>
        <EnTetePage titre="Nouveau dossier" />
        <Carte>
          <Vide>Aucune démarche active : l'admin du service doit d'abord en créer une.</Vide>
        </Carte>
      </>
    );
  const demarche = etat.demarches[role.service][demarcheId] || demarches[0][1];
  const controles = controlesOuverture(etat, role, demarche);
  const nin = normaliserIu(iu);

  const verifier = async () => {
    setEnCours("verifier");
    try {
      const p = await verifierIdentite(nin, role.service);
      setTitulaire(p ? { ok: true, p } : { ok: false, msg: "Identifiant unique inconnu du registre d'identité." });
    } catch (e) {
      setTitulaire({ ok: false, msg: e.message });
    }
    setEnCours(null);
  };

  const ouvrir = async (e) => {
    e.preventDefault();
    setEnCours("ouvrir");
    try {
      const r = await creerDossier(role, nin, demarcheId || demarches[0][0]);
      if (r.ok) {
        toast(`Dossier ${r.id} ouvert${r.bilan ? ` : ${resumeBilan(r.bilan)}` : ""}.`);
        navigate(`/agent/dossiers/${r.id}`);
        return;
      }
      setResultat(r);
    } catch (err) {
      setResultat({ ok: false, msg: err instanceof RegistreInjoignable ? err.message : "Ouverture impossible." });
    }
    setEnCours(null);
  };

  return (
    <>
      <EnTetePage titre="Nouveau dossier">
        Le citoyen ne donne <b>que son identifiant unique</b>. Aucune pièce déjà détenue par un registre branché ne lui est demandée.
      </EnTetePage>
      <Carte className="guichet">
        <form onSubmit={ouvrir}>
          <Etape n="1" titre="Identité du citoyen">
            <label htmlFor="nd-iu">Identifiant unique (NIN, en haut de la CNIB)</label>
            <DonneesTest profil="dossier" onChoisir={(code) => { setIu(code); setTitulaire(null); }} />
            <div className="ligne-champ">
              <input
                id="nd-iu"
                type="text"
                placeholder="17 chiffres"
                inputMode="numeric"
                maxLength={17}
                value={iu}
                onChange={(e) => {
                  setIu(e.target.value);
                  setTitulaire(null);
                }}
              />
              <Bouton variante="second" onClick={verifier} enCours={enCours === "verifier"}>
                Vérifier
              </Bouton>
            </div>
            {titulaire?.ok ? (
              <Alerte ton="info">
                Titulaire : <b>{titulaire.p.prenoms} {titulaire.p.nom}</b>. Vérifiez en face que c'est bien la personne présente.
                Les pièces seront récupérées dès l'ouverture du dossier.
              </Alerte>
            ) : titulaire ? (
              <Alerte ton="ko">{titulaire.msg}</Alerte>
            ) : null}
          </Etape>

          <Etape n="2" titre="Démarche">
            <Selection label="Démarche" value={demarcheId} onChange={(e) => setDemarcheId(e.target.value)} options={demarches.map(([id, d]) => [id, d.nom])} />
            <p className="sous resume">
              <b>Finalité de chaque consultation :</b> {demarche.finalite} · accord valable {demarche.duree} jours
            </p>
            <Tableau entetes={["Pièce", "Registre source"]}>
              {demarche.pieces.map((t) => (
                <tr key={t}>
                  <td>{TYPES_PIECE[t]}</td>
                  <td>{registreSource(etat, annuaire, t, role.service)}</td>
                </tr>
              ))}
            </Tableau>
          </Etape>

          <Etape n="3" titre="Contrôles de la passerelle">
            <ul className="controles">
              {controles.map((c) => (
                <li key={c.id} className={c.ok ? "ok" : "ko"}>
                  {c.ok ? "✓" : "✗"} {c.libelle}
                </li>
              ))}
            </ul>
          </Etape>

          <div className="actions">
            <Bouton type="submit" enCours={enCours === "ouvrir"} disabled={controles.some((c) => !c.ok)}>
              Ouvrir le dossier
            </Bouton>
          </div>
        </form>
        <Retour resultat={resultat} />
      </Carte>
    </>
  );
}

// ── Dossiers du service ──────────────────────────────────────────────────────
function OuvrirParNumero() {
  const { role } = useEspace();
  const navigate = useNavigate();
  const [numero, setNumero] = useState("");
  const [resultat, setResultat] = useState(null);
  const ouvrir = async (e) => {
    e.preventDefault();
    const id = normaliserIu(numero);
    const r = await controlerAcces(role, id);
    if (r.ok) navigate(`/agent/dossiers/${id}`);
    else setResultat(r);
  };
  return (
    <Carte titre="Ouvrir un dossier par son numéro">
      <form className="ligne-champ etroit" onSubmit={ouvrir}>
        <input type="text" placeholder="D-0001" value={numero} onChange={(e) => setNumero(e.target.value)} aria-label="Numéro de dossier" />
        <Bouton type="submit" variante="second">
          Ouvrir
        </Bouton>
      </form>
      <Retour resultat={resultat} />
    </Carte>
  );
}

export function Dossiers({ id }) {
  const etat = useSocle();
  const { role } = useEspace();
  const ds = dossiersDuService(etat, role.service);
  const recherche = useRecherche(ds, (d) => [d.id, nomDe(etat, d.iu), d.iu, d.finalite, STATUT_DOSSIER[d.statut]?.[1],
    piecesDe(d).map(([t, x]) => [TYPES_PIECE[t], STATUT_PIECE[x.statut]?.[1]])]);
  if (id) return <DetailDossier id={id} />;
  return (
    <>
      <EnTetePage titre={`Dossiers — ${nomService(etat, role.service)}`}>Vous ne voyez que les dossiers de votre service.</EnTetePage>
      <Carte>
        {ds.length ? (
          <>
          <BarreRecherche recherche={recherche} total={ds.length} placeholder="Rechercher : n° de dossier, nom, NIN, démarche, statut, pièce…" />
          <Tableau entetes={["Dossier", "Citoyen", "Démarche", "Statut", "Pièces", ""]}>
            {recherche.resultats.map((d) => {
              const { obtenues, total } = avancement(d);
              const indisponibles = piecesDe(d).filter(([, x]) => x.statut === "indisponible").length;
              return (
                <tr key={d.id}>
                  <td>
                    <Mono>{d.id}</Mono>
                  </td>
                  <td>
                    {nomDe(etat, d.iu)}
                    <br />
                    <small className="mono">{d.iu}</small>
                  </td>
                  <td>{d.finalite}</td>
                  <td>
                    <StatutDossier statut={d.statut} />
                  </td>
                  <td>
                    {obtenues} / {total} {indisponibles ? <Pastille ton="ko">{indisponibles} indisponible(s)</Pastille> : null}
                  </td>
                  <td>
                    <Link className="btn second petit" to={`/agent/dossiers/${d.id}`}>
                      Ouvrir
                    </Link>
                  </td>
                </tr>
              );
            })}
            {recherche.resultats.length ? null : <AucunResultat colonnes={6} recherche={recherche} />}
          </Tableau>
          </>
        ) : (
          <Vide>Aucun dossier pour l'instant.</Vide>
        )}
      </Carte>
      <OuvrirParNumero />
    </>
  );
}

function Provenance({ etat, x }) {
  const noms = (ids) => (ids || []).map((id) => (id === "passerelle" ? "passerelle" : nomService(etat, id))).join(", ");
  switch (x.statut) {
    case "fournie":
      return x.provenance === "service" ? (
        <>
          <Pastille ton="ok">Transmise par {x.nomService || x.source}</Pastille>
          <br />
          <small className="sous">{x.titre || ""}</small>
        </>
      ) : (
        <>
          <Pastille ton="att">Fournie par l'usager, non certifiée</Pastille>
          <br />
          <small className="mono">{(x.empreinte || "").slice(0, 16)}…</small>
        </>
      );
    case "repondu":
      return x.valeur === null ? (
        <small>Personne inconnue de {x.nomService || "registre"}.</small>
      ) : (
        <Pastille ton="info">Répondu par {x.nomService || "le registre"} (donnée source non transmise)</Pastille>
      );
    case "indisponible":
      return <small>Registre en panne : {noms(x.pannes)}. Nouvelle tentative à la relance.</small>;
    case "sans_source":
      return <small>{x.refus ? `Refusée par ${noms(x.refus)} : votre service n'y est pas autorisé.` : "Aucun registre branché ne fournit cette réponse."}</small>;
    case "a_choisir":
      return <small>{(x.candidats || []).length} pièces trouvées : à préciser avec le citoyen.</small>;
    case "a_fournir":
      return (
        <small>
          {x.refus ? `Refusée par ${noms(x.refus)} (votre service n'y est pas autorisé)` : (x.registres || []).length ? "Aucun registre ne la détient" : "Aucun registre ne la propose"} : le
          citoyen la présente au guichet.
        </small>
      );
    case "en_attente":
      return <small>Demandée après l'accord du citoyen.</small>;
    default:
      return "—";
  }
}

function DetailDossier({ id }) {
  const etat = useSocle();
  const { role } = useEspace();
  const toast = useToast();
  const [acces, setAcces] = useState(null);
  const [consultation, setConsultation] = useState(null);
  const [relance, setRelance] = useState(false);
  const relanceAuto = useRef(null);

  // Un lien direct vers le dossier d'un autre service est refusé et journalisé, comme l'ouverture par numéro.
  // Dépendances primitives : l'objet rôle est recréé à chaque modification de l'état.
  const { code, service } = role;
  useEffect(() => {
    controlerAcces({ ...role, code, service }, id).then(setAcces);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, service, id]);

  const d = etat.dossiers[id];
  const relancer = async (auto) => {
    setRelance(true);
    const bilan = await relancerRecherche(id);
    setRelance(false);
    if (!auto) toast(bilan ? `Recherche relancée : ${resumeBilan(bilan)}.` : "Rien à rechercher.");
  };

  // Reprise automatique : à l'ouverture du dossier, les pièces indisponibles sont redemandées une fois.
  useEffect(() => {
    if (!acces?.ok || !d || relanceAuto.current === id) return;
    relanceAuto.current = id;
    if (consentementActif(d) && piecesDe(d).some(([, x]) => x.statut === "indisponible")) relancer(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acces, id]);

  const retour = (
    <p>
      <Link to="/agent/dossiers">← Tous les dossiers</Link>
    </p>
  );
  if (!acces) return null;
  if (!acces.ok)
    return (
      <>
        {retour}
        <Alerte ton="ko">{acces.msg}</Alerte>
      </>
    );

  const consulter = async (t) => {
    const r = await consulterPiece(role, id, t);
    if (r.ok) setConsultation(r);
    else toast(r.msg);
  };
  const aRelancer = consentementActif(d) && !estFinal(d) && piecesDe(d).some(([, x]) => ["indisponible", "a_fournir", "sans_source"].includes(x.statut));

  return (
    <>
      {retour}
      <Carte>
        <h1>
          Dossier <Mono>{d.id}</Mono> <StatutDossier statut={d.statut} />
        </h1>
        <p className="sous">
          {nomDe(etat, d.iu)} · <Mono>{d.iu}</Mono> · {d.finalite} · ouvert par {d.agentCode} le {dateFr(d.cree)} · accord valable jusqu'au{" "}
          {jourFr(d.expire)}
          {d.base_legale ? (
            <>
              <br />
              Base légale : {d.base_legale}
            </>
          ) : null}
        </p>
        {enAttenteAccord(d) ? <Alerte ton="att">En attente de l'accord du citoyen, prévenu par SMS. Les registres seront interrogés dès qu'il aura accepté.</Alerte> : null}
        {d.statut === "refuse" ? <Alerte ton="ko">Le citoyen a refusé : aucune pièce n'est demandée ni consultable.</Alerte> : null}
        {d.statut === "revoque" ? <Alerte ton="ko">Le citoyen a retiré son accord : les pièces ne sont plus consultables.</Alerte> : null}
        {d.statut === "clos" ? <Alerte ton="info">Dossier clôturé le {dateFr(d.cloture)} : accès temporaires désactivés, traces conservées au journal.</Alerte> : null}
        {!estFinal(d) && estExpire(d) ? <Alerte ton="ko">Accord expiré : les pièces ne sont plus consultables.</Alerte> : null}

        <Tableau entetes={["Pièce", "État", "Provenance", ""]}>
          {piecesDe(d).map(([t, x]) => {
            const motif = motifRefus(d, t);
            return (
              <tr key={t}>
                <td>{TYPES_PIECE[t]}</td>
                <td>
                  <StatutPiece statut={x.statut} />
                  {x.statut === "repondu" && x.valeur !== null ? <b> {x.valeur ? "oui" : "non"}</b> : null}
                </td>
                <td>
                  <Provenance etat={etat} x={x} />
                </td>
                <td>
                  {x.statut === "fournie" ? (
                    <Bouton petit disabled={Boolean(motif)} title={motif || undefined} onClick={() => consulter(t)}>
                      Consulter
                    </Bouton>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </Tableau>
        <div className="actions">
          {aRelancer ? (
            <Bouton variante="second" petit enCours={relance} onClick={() => relancer(false)}>
              Relancer la recherche
            </Bouton>
          ) : null}
          {!estFinal(d) ? (
            <Bouton variante="danger" petit onClick={() => cloreDossier(role, id).catch((err) => toast(err.message))}>
              Clôturer le dossier
            </Bouton>
          ) : null}
        </div>
      </Carte>
      {consultation ? (
        <Visionneuse consultation={consultation} nomTitulaire={nomDe(etat, d.iu)} codeAgent={role.code} onFermer={() => setConsultation(null)} />
      ) : null}
    </>
  );
}
