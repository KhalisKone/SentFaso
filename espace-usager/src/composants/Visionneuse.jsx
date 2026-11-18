import { TYPES_PIECE } from "../noyau/referentiel.js";
import { Modale } from "../ui/Modale.jsx";

/** Lecture seule d'une pièce, avec filigrane (code agent, date, dossier) et sans téléchargement. */
export function Visionneuse({ consultation, nomTitulaire, codeAgent, onFermer }) {
  const { dossier, piece, type, source } = consultation;
  const filigrane = `${codeAgent} · ${new Date().toLocaleDateString("fr-FR")} · ${dossier.id}`;
  return (
    <Modale titre={`${TYPES_PIECE[type]} — ${nomTitulaire}`} onFermer={onFermer}>
      <p className="sous">Lecture seule · filigrane · téléchargement désactivé · consultation journalisée</p>
      <div className="visu" onContextMenu={(e) => e.preventDefault()}>
        {source ? (
          source.type === "application/pdf" ? (
            <iframe src={`${source.url}#toolbar=0`} title="Pièce" />
          ) : (
            <img src={source.url} alt="" />
          )
        ) : (
          <div className="visu-absente sous">
            Fichier non disponible dans la maquette (rechargement de la page).
            <br />
            Empreinte : <span className="mono">{piece.empreinte}</span>
          </div>
        )}
        <div className="filigrane" aria-hidden>
          {Array.from({ length: 24 }, (_, i) => (
            <span key={i}>{filigrane}</span>
          ))}
        </div>
      </div>
    </Modale>
  );
}
