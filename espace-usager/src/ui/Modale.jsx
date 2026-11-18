import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Bouton } from "./Bouton.jsx";

export function Modale({ titre, onFermer, children }) {
  useEffect(() => {
    const echap = (e) => e.key === "Escape" && onFermer();
    document.addEventListener("keydown", echap);
    return () => document.removeEventListener("keydown", echap);
  }, [onFermer]);

  return createPortal(
    <div className="modale" role="dialog" aria-modal="true" aria-label={titre} onClick={(e) => e.target === e.currentTarget && onFermer()}>
      <div className="boite">
        <div className="boite-entete">
          <h2>{titre}</h2>
          <Bouton variante="second" petit onClick={onFermer}>
            Fermer
          </Bouton>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
