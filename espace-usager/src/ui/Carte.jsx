import { cls } from "./cls.js";

export function Carte({ titre, etroite, className, children, ...props }) {
  return (
    <div className={cls("carte", etroite && "etroite", className)} {...props}>
      {titre ? <h2>{titre}</h2> : null}
      {children}
    </div>
  );
}

export function EnTetePage({ titre, children }) {
  return (
    <>
      <h1 className="titre-page">{titre}</h1>
      {children ? <p className="sous">{children}</p> : null}
    </>
  );
}

export const Vide = ({ children }) => <p className="vide">{children}</p>;
