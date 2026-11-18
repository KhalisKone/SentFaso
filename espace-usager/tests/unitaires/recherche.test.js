import { describe, expect, it } from "vitest";
import { correspond, normaliser } from "../../src/ui/Recherche.jsx";

describe("recherche en temps réel", () => {
  it("ignore les accents et les majuscules", () => {
    expect(normaliser("Établissement de la CNIB")).toBe("etablissement de la cnib");
    expect(correspond("Aïssata DIALLO", "aissata")).toBe(true);
    expect(correspond("Tribunal de grande instance", "TRIBUNAL")).toBe(true);
  });
  it("exige tous les mots, dans n'importe quel ordre", () => {
    expect(correspond("Demande de passeport · En attente du citoyen", "attente passeport")).toBe(true);
    expect(correspond("Demande de passeport · Complet", "attente passeport")).toBe(false);
  });
  it("une requête vide correspond à tout", () => {
    expect(correspond("n'importe quoi", "   ")).toBe(true);
  });
});
