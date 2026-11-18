/** Bouton « Données de test » (mode démonstration seulement) : propose des profils fictifs et remplit le champ choisi. */
import { useEffect, useRef, useState } from "react";
import { requete } from "../api/client.js";
import { NOTE_PROFILS, PROFILS_TEST } from "../noyau/donnees-test.js";

let mode = null; // demandé une seule fois au serveur
const ecouteurs = new Set();

export function useModeDemo() {
  const [demo, setDemo] = useState(mode?.demonstration ?? false);
  useEffect(() => {
    if (mode) return setDemo(mode.demonstration);
    ecouteurs.add(setDemo);
    if (ecouteurs.size === 1)
      requete("/session/mode").then(
        (m) => ((mode = m), ecouteurs.forEach((f) => f(m.demonstration))),
        () => ((mode = { demonstration: false }), ecouteurs.forEach((f) => f(false))),
      );
    return () => ecouteurs.delete(setDemo);
  }, []);
  return demo;
}

export function DonneesTest({ profil, onChoisir }) {
  const demo = useModeDemo();
  const [ouvert, setOuvert] = useState(false);
  const boite = useRef(null);
  useEffect(() => {
    if (!ouvert) return undefined;
    const fermer = (e) => boite.current && !boite.current.contains(e.target) && setOuvert(false);
    document.addEventListener("mousedown", fermer);
    return () => document.removeEventListener("mousedown", fermer);
  }, [ouvert]);
  if (!demo) return null;
  return (
    <div className="donnees-test" ref={boite}>
      <button type="button" className="lien-texte" onClick={() => setOuvert(!ouvert)} aria-expanded={ouvert}>
        🧪 Données de test
      </button>
      {ouvert ? (
        <div className="donnees-test-liste" role="menu">
          {PROFILS_TEST[profil].map(([code, libelle]) => (
            <button key={code} type="button" role="menuitem" onClick={() => { onChoisir(code); setOuvert(false); }}>
              <span>{libelle}</span>
              <small className="mono">{code}</small>
            </button>
          ))}
          {NOTE_PROFILS[profil] ? <small className="sous donnees-test-note">{NOTE_PROFILS[profil]}</small> : null}
        </div>
      ) : null}
    </div>
  );
}
