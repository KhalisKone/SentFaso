import { useId } from "react";

export function Champ({ label, type = "text", ...props }) {
  const id = useId();
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} {...props} />
    </>
  );
}

/** Champ pour un identifiant unique (17 chiffres). */
export const ChampIu = ({ label = "Identifiant unique", ...props }) => (
  <Champ label={label} placeholder="17 chiffres" inputMode="numeric" maxLength={17} autoComplete="off" {...props} />
);

export function Selection({ label, options, ...props }) {
  const id = useId();
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <select id={id} {...props}>
        {options.map(([valeur, libelle]) => (
          <option key={valeur} value={valeur}>
            {libelle}
          </option>
        ))}
      </select>
    </>
  );
}

export const Coche = ({ children, ...props }) => (
  <label className="coche">
    <input type="checkbox" {...props} /> <span>{children}</span>
  </label>
);
