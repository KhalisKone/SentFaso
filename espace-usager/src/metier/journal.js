/** Contrôle d'intégrité du journal (fait par le serveur) et démonstration de falsification. */
import { falsifierDemo, verifierJournal } from "../api/journal.js";
import { socle } from "../donnees/socle.js";

export async function controlerJournal() {
  try {
    return await verifierJournal();
  } catch {
    return { ok: false, raison: "vérification impossible : le socle est injoignable" };
  }
}

/** Démo : modifie une ligne directement en base, sans recalculer son empreinte. */
export async function falsifierUneLigne() {
  try {
    const { id } = await falsifierDemo();
    await socle.relireJournal();
    return id;
  } catch {
    return null;
  }
}
