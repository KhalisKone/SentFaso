/** Bulletin du banc de conformité : verdict, puis chaque critère (obligatoire ou recommandé) avec son détail. */
import { Pastille } from "../ui/Signaux.jsx";
import { Tableau } from "../ui/Tableau.jsx";

const icone = (c) => (c.ok === null || c.ok === undefined ? "➖" : c.ok ? "✅" : c.niveau === "obligatoire" ? "❌" : "⚠️");

export function BulletinConformite({ resultat }) {
  if (!resultat) return null;
  return (
    <div className="bulletin">
      <div className={`bulletin-verdict ${resultat.conforme ? "ok" : "ko"}`}>
        <b>{resultat.conforme ? "✅ Conforme au contrat" : "❌ Non conforme"}</b>
        <span>
          {resultat.obligatoires_ok} / {resultat.obligatoires} critères obligatoires · {resultat.recommandes_ok} / {resultat.recommandes} recommandés
        </span>
        <small>Passé le {resultat.le?.replace("T", " à ")} · inscrit au journal</small>
      </div>
      <Tableau entetes={["", "Critère", "Niveau", "Détail"]}>
        {resultat.criteres.map((c) => (
          <tr key={c.id} className={c.ok === false ? "critere-ko" : ""}>
            <td>{icone(c)}</td>
            <td>{c.critere}</td>
            <td>
              <Pastille ton={c.niveau === "obligatoire" ? "info" : "neutre"}>{c.niveau === "obligatoire" ? "obligatoire" : "recommandé"}</Pastille>
            </td>
            <td>
              <small className="sous">{c.detail}</small>
            </td>
          </tr>
        ))}
      </Tableau>
    </div>
  );
}
