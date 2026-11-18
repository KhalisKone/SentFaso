import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { socle } from "../donnees/socle.js";

const ContexteToast = createContext(() => {});
export const useToast = () => useContext(ContexteToast);

/** Messages brefs en bas d'écran. Les erreurs d'enregistrement du socle y apparaissent aussi. */
export function Toasts({ children }) {
  const [messages, setMessages] = useState([]);
  const suivant = useRef(0);

  const afficher = useCallback((texte) => {
    const id = ++suivant.current;
    setMessages((m) => [...m, { id, texte }]);
    setTimeout(() => setMessages((m) => m.filter((x) => x.id !== id)), 3500);
  }, []);

  useEffect(() => socle.surErreur(afficher), [afficher]);

  return (
    <ContexteToast.Provider value={afficher}>
      {children}
      <div className="toasts" aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className="toast">
            {m.texte}
          </div>
        ))}
      </div>
    </ContexteToast.Provider>
  );
}
