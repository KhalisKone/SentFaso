/** Identifiant unique (NIN, 17 chiffres). */

export const IU_VALIDE = /^\d{17}$/;
export const normaliserIu = (v) => String(v || "").replace(/\s+/g, "");
