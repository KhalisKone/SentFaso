import { Link } from "react-router-dom";
import armoiries from "../assets/armoiries.png";

export function EnTete({ sousTitre, children }) {
  return (
    <header>
      <div className="barre">
        <Link className="marque" to="/">
          <img src={armoiries} alt="Armoiries du Burkina Faso" />
          <span>
            <em>Burkina Faso</em>Dites-le-nous une fois<small>{sousTitre}</small>
          </span>
        </Link>
        <div className="outils">
          {children}
          <Link className="btn-telecharger" to="/telecharger" title="Application Android, Linux et Windows">
            ⬇ Télécharger l'application
          </Link>
        </div>
      </div>
    </header>
  );
}

export function PiedDePage({ devise }) {
  return (
    <footer>
      République du Burkina Faso · Socle d'interopérabilité « Dites-le-nous une fois »
      {devise ? " · La Patrie ou la Mort, nous Vaincrons" : ""}
    </footer>
  );
}
