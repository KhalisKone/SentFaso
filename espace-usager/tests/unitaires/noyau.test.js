/** Règles pures de l'espace usager : référentiel, identité, dossiers, sélecteurs. */
import { describe, expect, it } from "vitest";
import { avancement, majStatutDossier } from "../../src/noyau/dossiers.js";
import { identifiantDe } from "../../src/noyau/format.js";
import { IU_VALIDE, normaliserIu } from "../../src/noyau/identite.js";
import { PREDICATS, TYPES_DOCUMENT, estPredicat } from "../../src/noyau/referentiel.js";
import { dossiersDe, nomDe, roleDe, rolesDe } from "../../src/noyau/selecteurs.js";

describe("identifiant unique", () => {
  it("compte 17 chiffres, espaces ignorés", () => {
    expect(IU_VALIDE.test(normaliserIu("990 0000 0000 0000 01"))).toBe(true);
    expect(IU_VALIDE.test("9900")).toBe(false);
  });
});

describe("référentiel", () => {
  it("sépare pièces et réponses minimales", () => {
    expect(PREDICATS).toEqual(["majeur", "casier_vierge"]);
    expect(estPredicat("majeur")).toBe(true);
    expect(TYPES_DOCUMENT).not.toContain("majeur");
    expect(TYPES_DOCUMENT).toContain("acte_naissance");
  });
  it("tire l'identifiant d'un service de son nom", () => {
    expect(identifiantDe("Ministère de la Fonction publique")).toBe("ministere-de-la-fonction-publique");
  });
});

describe("dossier", () => {
  const dossier = (pieces, consent = "actif") => ({ statut: "autorise", consent: { statut: consent }, pieces });
  it("est complet quand toutes les pièces sont obtenues", () => {
    const d = dossier({ a: { statut: "fournie" }, b: { statut: "repondu" } });
    majStatutDossier(d);
    expect(d.statut).toBe("complet");
  });
  it("reste en cours tant qu'une pièce manque, et ne bouge pas sans accord actif", () => {
    const d = dossier({ a: { statut: "fournie" }, b: { statut: "indisponible" } });
    majStatutDossier(d);
    expect(d.statut).toBe("autorise");
    const attente = { ...dossier({ a: { statut: "fournie" } }, "en_attente"), statut: "en_attente_citoyen" };
    majStatutDossier(attente);
    expect(attente.statut).toBe("en_attente_citoyen");
  });
  it("compte l'avancement sans les pièces refusées", () => {
    expect(avancement(dossier({ a: { statut: "fournie" }, b: { statut: "a_fournir" }, c: { statut: "refusee" } }))).toEqual({ obtenues: 1, total: 2 });
  });
});

describe("sélecteurs", () => {
  const etat = {
    personnes: { 1: { nom: "KABORE", prenoms: "Aminata" } },
    roles: [{ iu: "1", role: "agent", service: "s", statut: "actif" }, { iu: "1", role: "admin", service: "s", statut: "revoque" }],
    dossiers: { a: { iu: "1", cree: "2026-01-01" }, b: { iu: "2", cree: "2026-01-02" }, c: { iu: "1", cree: "2026-01-03" } },
  };
  it("nom, rôles actifs, dossiers du citoyen du plus récent au plus ancien", () => {
    expect(nomDe(etat, "1")).toBe("Aminata KABORE");
    expect(rolesDe(etat, "1")).toEqual(["agent"]);
    expect(roleDe(etat, "1", "admin")).toBeNull();
    expect(dossiersDe(etat, "1").map((d) => d.cree)).toEqual(["2026-01-03", "2026-01-01"]);
  });
});
