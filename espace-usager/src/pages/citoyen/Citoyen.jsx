/** Espace citoyen : demandes, dépôt des pièces, documents confiés, journal des consultations. */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useSocle } from "../../donnees/hooks.js";
import { useEspace } from "../../mise-en-page/espace.js";
import { choisirPiece } from "../../metier/consentement.js";
import { deposer } from "../../metier/depots.js";
import { dateFr, jourFr, plusMois } from "../../noyau/format.js";
import { CONSERVATION_MOIS, STATUT_DOSSIER, STATUT_PIECE, TYPES_PIECE, libRole } from "../../noyau/referentiel.js";
import { consentementActif, dossiersDe, nomService, piecesDe } from "../../noyau/selecteurs.js";
import { Bouton } from "../../ui/Bouton.jsx";
import { Carte, EnTetePage, Vide } from "../../ui/Carte.jsx";
import { Coche } from "../../ui/Champs.jsx";
import { Action } from "../../composants/TableJournal.jsx";
import { AucunResultat, BarreRecherche, useRecherche } from "../../ui/Recherche.jsx";
import { Alerte, Pastille, Retour, StatutDossier, StatutPiece } from "../../ui/Signaux.jsx";
import { Mono, Tableau } from "../../ui/Tableau.jsx";
import { useToast } from "../../ui/Toasts.jsx";

const aFournir = (etat, iu) =>
  dossiersDe(etat, iu)
    .filter(consentementActif)
    .flatMap((d) => piecesDe(d).filter(([, x]) => ["a_fournir", "en_file"].includes(x.statut)).map(([t, x]) => ({ d, t, x })));

export const compteurs = {
  demandes: (etat, iu) =>
    dossiersDe(etat, iu).filter((d) => piecesDe(d).some(([, x]) => ["a_fournir", "a_choisir"].includes(x.statut))).length,
  depots: (etat, iu) => aFournir(etat, iu).filter(({ x }) => x.statut === "a_fournir").length,
};

// ── Mes demandes ─────────────────────────────────────────────────────────────
function EtatPiece({ x }) {
  if (x.statut === "indisponible") return <Pastille ton="info">Registre momentanément indisponible : récupérée dès son retour</Pastille>;
  if (x.statut === "a_choisir") return <Pastille ton="att">Choisissez la pièce à joindre ci-dessous</Pastille>;
  if (x.statut === "en_attente") return <Pastille ton="att">En attente de votre accord</Pastille>;
  if (x.provenance === "service")
    return (
      <>
        <Pastille ton="ok">Récupérée</Pastille> chez <b>{x.nomService}</b>
      </>
    );
  if (x.statut === "repondu")
    return x.valeur === null ? (
      <Pastille ton="neutre">Inconnu du registre</Pastille>
    ) : (
      <>
        <Pastille ton="ok">{`Répondu : ${x.valeur ? "oui" : "non"}`}</Pastille>
        {x.nomService ? <small className="sous"> par {x.nomService}, sans transmettre la donnée</small> : null}
      </>
    );
  if (x.statut === "sans_source") return <Pastille ton="neutre">Aucun registre ne fournit cette réponse</Pastille>;
  if (x.statut === "a_fournir")
    return (
      <>
        <Pastille ton="att">À charger</Pastille> <Link to="/citoyen/depots">Charger</Link>
      </>
    );
  return <StatutPiece statut={x.statut} />;
}

/** Plusieurs registres détiennent la pièce : le citoyen choisit celle qui sera jointe. */
function ChoixPiece({ d, t, x }) {
  const { iu } = useEspace();
  const [index, setIndex] = useState(0);
  return (
    <div className="choix-piece">
      <b>{TYPES_PIECE[t]}</b> : plusieurs pièces trouvées, laquelle joindre au dossier ?
      {(x.candidats || []).map((c, i) => (
        <label key={i} className="coche">
          <input type="radio" name={`${d.id}-${t}`} checked={index === i} onChange={() => setIndex(i)} />
          <span>
            {c.titre} — <b>{c.nomService}</b>
            {c.date ? ` · ${c.date}` : ""}
          </span>
        </label>
      ))}
      <Bouton petit onClick={() => choisirPiece(iu, d.id, t, index)}>
        Joindre cette pièce
      </Bouton>
    </div>
  );
}

function CarteDemande({ d }) {
  const etat = useSocle();
  const service = nomService(etat, d.service);

  return (
    <Carte className="demande">
      <h2>
        {service} — {d.finalite} <StatutDossier statut={d.statut} />
      </h2>
      <p className="sous">
        Dossier <Mono>{d.id}</Mono> · ouvert par l'agent <b>{d.agentCode}</b> le {dateFr(d.cree)}
        {d.but ? ` · ${d.but}` : ""}
        {d.base_legale ? ` · base légale : ${d.base_legale}` : ""} · valable jusqu'au {dateFr(d.expire)}
      </p>
      <Tableau entetes={["Pièce", "État"]}>
        {piecesDe(d).map(([t, x]) => (
          <tr key={t}>
            <td>{TYPES_PIECE[t]}</td>
            <td>
              <EtatPiece x={x} />
            </td>
          </tr>
        ))}
      </Tableau>
      {piecesDe(d)
        .filter(([, x]) => x.statut === "a_choisir")
        .map(([t, x]) => (
          <ChoixPiece key={t} d={d} t={t} x={x} />
        ))}
    </Carte>
  );
}

export function Demandes() {
  const etat = useSocle();
  const { iu } = useEspace();
  const ds = dossiersDe(etat, iu);
  const recherche = useRecherche(ds, (d) => [d.id, d.finalite, d.but, nomService(etat, d.service), STATUT_DOSSIER[d.statut]?.[1],
    piecesDe(d).map(([t, x]) => [TYPES_PIECE[t], STATUT_PIECE[x.statut]?.[1], x.nomService])]);
  return (
    <>
      <EnTetePage titre="Mes demandes">
        Les dossiers ouverts à votre nom. Les pièces déjà détenues par un registre sont récupérées automatiquement ; vous chargez seulement celles
        qu'aucun registre ne détient.
      </EnTetePage>
      {ds.length > 1 ? (
        <BarreRecherche recherche={recherche} total={ds.length} placeholder="Rechercher : service, démarche, n° de dossier, pièce…" />
      ) : null}
      {ds.length ? (
        recherche.resultats.length ? (
          recherche.resultats.map((d) => <CarteDemande key={d.id} d={d} />)
        ) : (
          <Carte>
            <Vide>Aucun résultat pour « {recherche.requete} ».</Vide>
          </Carte>
        )
      ) : (
        <Carte>
          <Vide>Aucune demande.</Vide>
        </Carte>
      )}
    </>
  );
}

// ── Pièces à fournir ─────────────────────────────────────────────────────────
function FormDepot({ d, t, x }) {
  const etat = useSocle();
  const toast = useToast();
  const [fichier, setFichier] = useState(null);
  const [accord, setAccord] = useState(false);
  const [resultat, setResultat] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const service = nomService(etat, d.service);

  const envoyer = async () => {
    setEnCours(true);
    const r = await deposer(d.id, t, fichier, accord);
    setEnCours(false);
    if (r.ok) toast(r.msg);
    else setResultat(r);
  };

  return (
    <Carte>
      <h2>
        {TYPES_PIECE[t]} <StatutPiece statut={x.statut} />
      </h2>
      <p className="sous">
        Pour <b>{service}</b> · dossier <Mono>{d.id}</Mono> · {d.finalite}
      </p>
      {x.statut === "en_file" ? (
        <Alerte ton="info">Fichier prêt : il partira automatiquement au retour du réseau.</Alerte>
      ) : (
        <>
          <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFichier(e.target.files[0] || null)} />
          <Coche checked={accord} onChange={(e) => setAccord(e.target.checked)}>
            J'envoie ce document à {service}, pour « {d.finalite} », conservé {CONSERVATION_MOIS} mois.
          </Coche>
          <div className="actions">
            <Bouton onClick={envoyer} enCours={enCours}>
              Envoyer
            </Bouton>
          </div>
          <Retour resultat={resultat} />
        </>
      )}
    </Carte>
  );
}

export function Depots() {
  const etat = useSocle();
  const { iu } = useEspace();
  const lignes = aFournir(etat, iu);
  return (
    <>
      <EnTetePage titre="Pièces à fournir">
        Déposez vos pièces depuis chez vous. Chaque fichier est envoyé <b>uniquement</b> au service qui l'a demandé.
      </EnTetePage>
      {lignes.length ? (
        lignes.map(({ d, t, x }) => <FormDepot key={`${d.id}/${t}`} d={d} t={t} x={x} />)
      ) : (
        <Carte>
          <Vide>Aucune pièce à fournir pour le moment.</Vide>
        </Carte>
      )}
    </>
  );
}

// ── Mes documents ────────────────────────────────────────────────────────────
export function Documents() {
  const etat = useSocle();
  const { iu } = useEspace();
  const lignes = dossiersDe(etat, iu).flatMap((d) =>
    piecesDe(d)
      .filter(([, x]) => x.statut === "fournie" && x.provenance !== "service")
      .map(([t, x]) => ({ d, t, x })),
  );
  const recherche = useRecherche(lignes, ({ d, t, x }) => [TYPES_PIECE[t], x.nomFichier, nomService(etat, d.service), d.id, dateFr(x.depose)]);
  return (
    <>
      <EnTetePage titre="Mes documents">
        Les pièces que vous avez confiées, à qui, et jusqu'à quand elles sont conservées. Aucun autre service n'y a accès.
      </EnTetePage>
      <Carte>
        {lignes.length ? (
          <>
          <BarreRecherche recherche={recherche} total={lignes.length} placeholder="Rechercher : pièce, service, dossier…" />
          <Tableau entetes={["Pièce", "Confiée à", "Dossier", "Déposée le", "Conservée jusqu'au"]}>
            {recherche.resultats.map(({ d, t, x }) => (
              <tr key={`${d.id}/${t}`}>
                <td>
                  {TYPES_PIECE[t]}
                  <br />
                  <small className="sous">{x.nomFichier}</small>
                </td>
                <td>{nomService(etat, d.service)}</td>
                <td>
                  <Mono>{d.id}</Mono>
                </td>
                <td>{dateFr(x.depose)}</td>
                <td>{jourFr(plusMois(x.depose, CONSERVATION_MOIS))}</td>
              </tr>
            ))}
            {recherche.resultats.length ? null : <AucunResultat colonnes={5} recherche={recherche} />}
          </Tableau>
          </>
        ) : (
          <Vide>Vous n'avez encore déposé aucune pièce.</Vide>
        )}
      </Carte>
    </>
  );
}

// ── Qui a consulté mes données ───────────────────────────────────────────────
export function Journal() {
  const etat = useSocle();
  const { iu } = useEspace();
  const lignes = etat.journal.filter((l) => l.iu === iu).reverse();
  const recherche = useRecherche(lignes, (l) => [dateFr(l.ts), l.casquette === "citoyen" ? "vous" : libRole(l.casquette), l.service && nomService(etat, l.service),
    l.code, l.action, l.resultat, l.cible, l.details]);
  return (
    <>
      <EnTetePage titre="Qui a consulté mes données">
        Chaque ligne est scellée dans un journal chaîné : toute modification ou suppression serait aussitôt détectée.
      </EnTetePage>
      <Carte>
        {lignes.length ? (
          <>
          <BarreRecherche recherche={recherche} total={lignes.length} placeholder="Rechercher : service, agent, pièce, date…" />
          <Tableau entetes={["Quand", "Qui", "Action", "Détail"]}>
            {recherche.resultats.map((l) => (
              <tr key={l.id}>
                <td>{dateFr(l.ts)}</td>
                <td>
                  {l.casquette === "citoyen" ? (
                    "Vous"
                  ) : l.casquette === "système" || l.casquette === "passerelle" ? (
                    <>
                      {libRole(l.casquette)}
                      {l.service ? (
                        <>
                          <br />
                          <small className="sous">pour {nomService(etat, l.service)}</small>
                        </>
                      ) : null}
                    </>
                  ) : (
                    <>
                      {nomService(etat, l.service)}
                      <br />
                      <small className="sous">
                        {libRole(l.casquette)} {l.code || ""}
                      </small>
                    </>
                  )}
                </td>
                <td>
                  <Action ligne={{ ...l, details: null }} />
                </td>
                <td>
                  {l.cible || ""}
                  {l.details ? (
                    <>
                      <br />
                      <small className="sous">{l.details}</small>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
            {recherche.resultats.length ? null : <AucunResultat colonnes={4} recherche={recherche} />}
          </Tableau>
          </>
        ) : (
          <Vide>Aucune activité.</Vide>
        )}
      </Carte>
    </>
  );
}
