import { describe, expect, it } from "vitest";
import { ficheBranchementPdf, octets } from "../../src/noyau/fiche-pdf.js";

const texte = (pdf) => String.fromCharCode(...pdf);

describe("fiche de branchement PDF", () => {
  const pdf = ficheBranchementPdf({ nom: "Mairie de Ouagadougou", id: "mairie-de-ouagadougou", secret: "sk_test(1)", url: "https://exemple/frontend/connect", par: "SA-0001" });
  const t = texte(pdf);

  it("est un PDF complet", () => {
    expect(t.startsWith("%PDF-1.4")).toBe(true);
    expect(t.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("a une table des renvois juste (chaque objet est à la position annoncée)", () => {
    const xref = Number(t.match(/startxref\n(\d+)/)[1]);
    expect(t.slice(xref, xref + 4)).toBe("xref");
    const positions = [...t.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(positions).toHaveLength(8);
    positions.forEach((p, i) => expect(t.slice(p, p + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });

  it("contient l'identifiant, le code (parenthèses échappées) et l'avertissement", () => {
    expect(t).toContain("(mairie-de-ouagadougou)");
    expect(t).toContain("sk_test\\(1\\)");
    expect(t).toContain("ne s'affiche qu'une seule fois");
  });

  it("encode les accents en WinAnsi", () => {
    expect([...octets("é«»’")]).toEqual([0xe9, 0xab, 0xbb, 0x92]);
  });
});
