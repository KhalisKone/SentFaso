import { Link } from "react-router-dom";
import { cls } from "./cls.js";

/** variante : "principal" (par défaut), "second", "danger", "test". */
export function Bouton({ variante, petit, enCours, className, children, disabled, type = "button", ...props }) {
  return (
    <button type={type} className={cls("btn", variante, petit && "petit", className)} disabled={disabled || enCours} {...props}>
      {enCours ? <span className="rond-attente" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function BoutonLien({ variante, petit, className, children, ...props }) {
  return (
    <Link className={cls("btn", variante, petit && "petit", className)} {...props}>
      {children}
    </Link>
  );
}
