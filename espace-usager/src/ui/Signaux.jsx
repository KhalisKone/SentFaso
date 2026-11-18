import { STATUT_DOSSIER, STATUT_PIECE } from "../noyau/referentiel.js";

/** ton : ok, att, ko, info, neutre. */
export const Pastille = ({ ton = "neutre", children }) => <span className={`p p-${ton}`}>{children}</span>;

export function PastilleStatut({ statut, table }) {
  const [ton, libelle] = table[statut] || ["neutre", statut];
  return <Pastille ton={ton}>{libelle}</Pastille>;
}
export const StatutDossier = ({ statut }) => <PastilleStatut statut={statut} table={STATUT_DOSSIER} />;
export const StatutPiece = ({ statut }) => <PastilleStatut statut={statut} table={STATUT_PIECE} />;

/** ton : ok, att, ko, info. */
export const Alerte = ({ ton = "info", children }) => (
  <div className={`alerte a-${ton}`} role={ton === "ko" ? "alert" : "status"}>
    {children}
  </div>
);

/** Message de résultat d'une action : { ok, msg } ou null. */
export const Retour = ({ resultat }) => (resultat ? <Alerte ton={resultat.ok ? "ok" : "ko"}>{resultat.msg}</Alerte> : null);
