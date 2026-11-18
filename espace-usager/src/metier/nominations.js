/** Nominations et révocations (super admin, admin, agent). */
import { socle } from "../donnees/socle.js";
import { maintenant, numero } from "../noyau/format.js";
import { libRole } from "../noyau/referentiel.js";
import { auteurDuRole, nomDe, rolesActifs } from "../noyau/selecteurs.js";
import { RegistreInjoignable, verifierIdentite } from "./identite.js";

export const PREFIXES = { super_admin: "SA", admin: "AD", agent: "AG" };

/** Nomme une personne (identifiant unique vérifié au registre) à un rôle, dans un service ou non. */
export async function nommer({ iu, role, service = null, par }) {
  let personne;
  try {
    personne = await verifierIdentite(iu, par?.service || "administration du socle");
  } catch (e) {
    if (e instanceof RegistreInjoignable) return { ok: false, msg: e.message };
    throw e;
  }
  if (!personne) return { ok: false, msg: "Identifiant unique inconnu du registre d'identité." };
  const dejaNomme = socle.lire().roles.some(
    (x) => x.iu === iu && x.role === role && x.statut === "actif" && (x.service ?? null) === (service ?? null),
  );
  if (dejaNomme) return { ok: false, msg: "Cette personne a déjà ce rôle." };

  const prefixe = PREFIXES[role];
  const code = socle.modifier((d) => {
    d.seq[prefixe] = (d.seq[prefixe] || 0) + 1;
    d.seq.role = (d.seq.role || 0) + 1;
    const code = numero(prefixe, d.seq[prefixe]);
    d.roles.push({ id: `R${d.seq.role}`, iu, role, service, code, statut: "actif", par: par?.code ?? null, le: maintenant() });
    return code;
  });
  socle.journaliser({ ...auteurDuRole(par), service, action: `Nomination : ${libRole(role)}`, cible: `${nomDe(socle.lire(), iu)} (${code})`, iu });
  return { ok: true, code };
}

/** Révoque, suspend ou réactive un rôle. Il doit toujours rester au moins un super admin. */
export function changerStatutRole(id, statut, par) {
  const x = socle.lire().roles.find((r) => r.id === id);
  if (!x) return { ok: false, msg: "Rôle introuvable." };
  if (statut !== "actif" && x.role === "super_admin" && rolesActifs(socle.lire(), "super_admin").length <= 1) {
    return { ok: false, msg: "Impossible : il doit toujours rester au moins un super admin." };
  }
  socle.modifier((d) => void (d.roles.find((r) => r.id === id).statut = statut));
  socle.journaliser({ ...auteurDuRole(par), service: x.service ?? null, action: `Rôle ${statut}`, cible: `${nomDe(socle.lire(), x.iu)} (${x.code})`, iu: x.iu });
  return { ok: true };
}
