/** Session de l'onglet : jeton signé par le socle et identifiant unique de la personne connectée. */
import { definirJeton, quandSessionExpire } from "../api/client.js";

const CLE = "dlnuf-session";
const abonnes = new Set();

function lireStockage() {
  try {
    const s = JSON.parse(sessionStorage.getItem(CLE));
    return s?.jeton && s?.iu ? s : null;
  } catch {
    return null;
  }
}
let courant = lireStockage();
definirJeton(courant?.jeton);
const emettre = () => abonnes.forEach((f) => f());

export const session = {
  /** { jeton, iu } ou null. */
  lire: () => courant,
  abonner(f) {
    abonnes.add(f);
    return () => abonnes.delete(f);
  },
  ouvrir({ jeton, iu }) {
    courant = { jeton, iu };
    definirJeton(jeton);
    try {
      sessionStorage.setItem(CLE, JSON.stringify(courant));
    } catch {
      /* stockage indisponible : la session vit en mémoire */
    }
    emettre();
  },
  fermer() {
    courant = null;
    definirJeton(null);
    try {
      sessionStorage.removeItem(CLE);
    } catch {
      /* rien à effacer */
    }
    emettre();
  },
};

quandSessionExpire(() => session.fermer());
