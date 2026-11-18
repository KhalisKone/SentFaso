/** Assemble des classes CSS en ignorant les valeurs vides. */
export const cls = (...classes) => classes.filter(Boolean).join(" ");
