// Lecture des index CSV (registres, citoyens) : colonnes lues par leur NOM (règle du socle : un registre peut ajouter des colonnes).
export function lireCsv(texte) {
  const lignes = String(texte).replace(/^﻿/, "").split(/\r?\n/).filter(l => l.trim());
  if (!lignes.length) return [];
  const entete = lignes[0].split(",").map(s => s.trim());
  return lignes.slice(1).map(l => {
    const v = l.split(",").map(s => s.trim());
    return Object.fromEntries(entete.map((k, i) => [k, v[i] ?? ""]));
  });
}
export const NIN = /^\d{17}$/;
export function aujourdhui(date = new Date()) { return date.toISOString().slice(0, 10); }
