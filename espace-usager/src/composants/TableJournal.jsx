import { dateFr } from "../noyau/format.js";
import { libRole } from "../noyau/referentiel.js";
import { Carte, Vide } from "../ui/Carte.jsx";
import { AucunResultat, BarreRecherche, useRecherche } from "../ui/Recherche.jsx";
import { Pastille } from "../ui/Signaux.jsx";
import { Mono, Tableau } from "../ui/Tableau.jsx";

export function Action({ ligne }) {
  return (
    <>
      {ligne.action} {ligne.resultat && ligne.resultat !== "réussi" ? <Pastille ton="ko">{ligne.resultat}</Pastille> : null}
      {ligne.details ? (
        <>
          <br />
          <small className="sous">{ligne.details}</small>
        </>
      ) : null}
    </>
  );
}

/** Journal d'administration (lignes les plus récentes en premier). */
export function TableJournal({ lignes, avecEmpreinte }) {
  const recherche = useRecherche(lignes, (l) => [l.id, dateFr(l.ts), libRole(l.casquette), l.code, l.auteur, l.action, l.resultat, l.details, l.cible]);
  if (!lignes.length)
    return (
      <Carte>
        <Vide>Aucune ligne.</Vide>
      </Carte>
    );
  return (
    <Carte>
      <BarreRecherche recherche={recherche} total={lignes.length} placeholder="Rechercher : action, personne, code, date…" />
      <Tableau entetes={["#", "Quand", "Qui", "Action", "Cible", ...(avecEmpreinte ? ["Empreinte"] : [])]}>
        {recherche.resultats.map((l) => (
          <tr key={l.id}>
            <td>{l.id}</td>
            <td>{dateFr(l.ts)}</td>
            <td>
              {libRole(l.casquette)} <Mono>{l.code || l.auteur || ""}</Mono>
            </td>
            <td>
              <Action ligne={l} />
            </td>
            <td>{l.cible || ""}</td>
            {avecEmpreinte ? (
              <td>
                <Mono>{(l.hash || "").slice(0, 12)}…</Mono>
              </td>
            ) : null}
          </tr>
        ))}
        {recherche.resultats.length ? null : <AucunResultat colonnes={avecEmpreinte ? 6 : 5} recherche={recherche} />}
      </Tableau>
    </Carte>
  );
}
