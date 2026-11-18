/** Annuaire des registres et récupération des pièces : chaque cas (transmise, à choisir, indisponible, refusée, réponse minimale). */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/api/connect.js", () => ({ listeBranchements: vi.fn(), documentsDe: vi.fn(), predicatDe: vi.fn() }));
vi.mock("../../src/api/journal.js", () => ({ ajouterLigne: vi.fn(async (l) => ({ ...l, id: 1 })), lireJournal: vi.fn(async () => []) }));
vi.mock("../../src/api/socle.js", () => ({ lireEtat: vi.fn(), ecrireEtat: vi.fn(async () => ({ ok: true })) }));

const api = await import("../../src/api/connect.js");
const { autorise, registresPour } = await import("../../src/metier/annuaire.js");
const { rechercherPieces } = await import("../../src/metier/recherche.js");
const { socle } = await import("../../src/donnees/socle.js");

const ANNUAIRE = {
  mairie: { nom: "Mairie", branche: true, catalogue: "registre", types: ["acte_naissance"], predicats: ["majeur"], autorisations: {} },
  tribunal: { nom: "Tribunal", branche: true, catalogue: "registre", types: ["casier_judiciaire"], predicats: ["casier_vierge"],
              autorisations: { casier_judiciaire: ["passeports"], casier_vierge: ["*"] } },
  nationalite: { nom: "Nationalité", branche: true, catalogue: "registre", types: ["acte_naissance", "certificat_nationalite"], predicats: [], autorisations: {} },
};

describe("annuaire", () => {
  it("respecte les règles décidées par chaque registre", () => {
    expect(autorise(ANNUAIRE.tribunal, "casier_judiciaire", "passeports")).toBe(true);
    expect(autorise(ANNUAIRE.tribunal, "casier_judiciaire", "mairie")).toBe(false);
    expect(registresPour(ANNUAIRE, "casier_judiciaire", "mairie")).toEqual({ ids: [], refuses: ["tribunal"], declare: true });
    expect(registresPour(ANNUAIRE, "acte_naissance", "x").ids).toEqual(["mairie", "nationalite"]);
    expect(registresPour(ANNUAIRE, "majeur", "x").ids).toEqual(["mairie"]);
  });
});

describe("recherche des pièces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listeBranchements.mockResolvedValue(ANNUAIRE);
    socle.vider();
    socle.modifier((e) => {
      e.services = { mairie: { nom: "Mairie" }, tribunal: { nom: "Tribunal" }, nationalite: { nom: "Nationalité" }, passeports: { nom: "Passeports" } };
      e.dossiers["D-1"] = { id: "D-1", iu: "1", service: "mairie", statut: "autorise", consent: { statut: "actif", autorisees: [] },
        pieces: { acte_naissance: { statut: "recherche" }, certificat_nationalite: { statut: "recherche" }, casier_judiciaire: { statut: "recherche" }, majeur: { statut: "recherche" } } };
    });
  });

  it("ne demande à chaque registre que ses pièces, et classe chaque résultat", async () => {
    api.documentsDe.mockResolvedValue([
      { service: "mairie", nom: "Mairie", documents: [{ id: "A1", type: "acte_naissance", titre: "Acte", url: "u1" }] },
      { service: "nationalite", nom: "Nationalité", documents: [{ id: "A2", type: "acte_naissance", titre: "Copie", url: "u2" }], erreur: "panne" },
    ]);
    api.predicatDe.mockResolvedValue([{ service: "mairie", nom: "Mairie", reponse: true }]);
    const bilan = await rechercherPieces("D-1");
    const [, services, contexte] = api.documentsDe.mock.calls[0];
    expect(services).toEqual(["mairie", "nationalite"]);
    expect(contexte.types).toEqual(["acte_naissance", "certificat_nationalite", "casier_judiciaire"]);
    const p = socle.lire().dossiers["D-1"].pieces;
    expect(p.acte_naissance).toMatchObject({ statut: "fournie", provenance: "service", source: "mairie", document: "A1" });
    expect(p.certificat_nationalite).toMatchObject({ statut: "indisponible", pannes: ["nationalite"] });
    expect(p.casier_judiciaire).toMatchObject({ statut: "a_fournir", refus: ["tribunal"] });
    expect(p.majeur).toMatchObject({ statut: "repondu", valeur: true, source: "mairie" });
    expect(bilan).toMatchObject({ trouvees: 2, indisponibles: 1, aFournir: 1 });
  });

  it("propose le choix quand deux registres détiennent la pièce", async () => {
    api.documentsDe.mockResolvedValue([
      { service: "mairie", nom: "Mairie", documents: [{ id: "A1", type: "acte_naissance", titre: "Acte", url: "u1" }] },
      { service: "nationalite", nom: "Nationalité", documents: [{ id: "A2", type: "acte_naissance", titre: "Copie", url: "u2" }] },
    ]);
    api.predicatDe.mockResolvedValue([]);
    await rechercherPieces("D-1");
    expect(socle.lire().dossiers["D-1"].pieces.acte_naissance.statut).toBe("a_choisir");
  });

  it("ne fait rien sans accord actif", async () => {
    socle.modifier((e) => (e.dossiers["D-1"].consent.statut = "en_attente"));
    expect(await rechercherPieces("D-1")).toBeNull();
    expect(api.documentsDe).not.toHaveBeenCalled();
  });
});
