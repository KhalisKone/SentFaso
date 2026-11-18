/** Espace citoyen, en lecture seule : ses demandes et qui a consulté ses données. */
import { useSocle } from "../../donnees/hooks.js";
import { useEspace } from "../../mise-en-page/espace.js";
import { dateFr } from "../../noyau/format.js";
import { STATUT_DOSSIER, STATUT_PIECE, TYPES_PIECE, libRole } from "../../noyau/referentiel.js";
import { dossiersDe, nomService, piecesDe } from "../../noyau/selecteurs.js";
import { Carte, EnTetePage, Vide } from "../../ui/Carte.jsx";
import { Action } from "../../composants/TableJournal.jsx";
import { AucunResultat, BarreRecherche, useRecherche } from "../../ui/Recherche.jsx";
import { Pastille, StatutDossier, StatutPiece } from "../../ui/Signaux.jsx";
import { Mono, Tableau } from "../../ui/Tableau.jsx";

// ── Mes demandes ─────────────────────────────────────────────────────────────
function EtatPiece({ x }) {
  if (x.statut === "indisponible") return <Pastille ton="info">Registre momentanément indisponible : récupérée dès son retour</Pastille>;
  if (x.statut === "a_choisir") return <Pastille ton="att">Plusieurs pièces trouvées : à préciser au guichet</Pastille>;
  if (x.statut === "en_attente") return <Pastille ton="att">En attente</Pastille>;
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
    return <Pastille ton="att">Aucun registre ne la détient : à présenter au guichet</Pastille>;
  return <StatutPiece statut={x.statut} />;
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
        Les dossiers ouverts à votre nom. Les pièces sont récupérées automatiquement auprès des administrations qui les détiennent :
        vous n'avez rien à fournir ni à faire ici.
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
