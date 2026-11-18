/**
 * Recherche en temps réel dans une liste : chaque frappe filtre aussitôt, sans tenir compte des accents ni des majuscules ;
 * plusieurs mots = tous doivent être présents (ex. « passeport attente »).
 */
import { useDeferredValue, useState } from "react";

export const normaliser = (s) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Vrai si chaque mot de la requête figure dans le texte. */
export function correspond(texte, requete) {
  const t = normaliser(texte);
  return normaliser(requete).split(/\s+/).filter(Boolean).every((m) => t.includes(m));
}

/** Filtre `elements` selon le texte que `texteDe(element)` renvoie (une chaîne ou une liste de valeurs). */
export function useRecherche(elements, texteDe) {
  const [requete, setRequete] = useState("");
  const differee = useDeferredValue(requete); // la saisie reste fluide même sur une longue liste
  const texte = (e) => [texteDe(e)].flat(Infinity).filter((x) => x !== null && x !== undefined).join(" ");
  const resultats = differee.trim() ? elements.filter((e) => correspond(texte(e), differee)) : elements;
  return { requete, setRequete, resultats, filtre: Boolean(differee.trim()) };
}

/** Champ de recherche : loupe, effacement (✕ ou Échap), nombre de résultats. */
export function BarreRecherche({ recherche, total, placeholder = "Rechercher…", libelle = "Rechercher dans la liste" }) {
  const { requete, setRequete, resultats, filtre } = recherche;
  return (
    <div className="recherche" role="search">
      <svg className="recherche-loupe" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="M15.5 15.5 21 21" />
      </svg>
      <input
        type="search"
        value={requete}
        placeholder={placeholder}
        aria-label={libelle}
        onChange={(e) => setRequete(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setRequete("")}
      />
      {requete ? (
        <button type="button" className="recherche-effacer" onClick={() => setRequete("")} aria-label="Effacer la recherche">
          ✕
        </button>
      ) : null}
      {filtre ? (
        <span className="recherche-compte" aria-live="polite">
          {resultats.length} / {total ?? "?"}
        </span>
      ) : null}
    </div>
  );
}

/** Ligne de tableau affichée quand la recherche ne trouve rien. */
export function AucunResultat({ colonnes, recherche }) {
  return (
    <tr>
      <td colSpan={colonnes} className="vide">
        Aucun résultat pour « {recherche.requete} ».
      </td>
    </tr>
  );
}
