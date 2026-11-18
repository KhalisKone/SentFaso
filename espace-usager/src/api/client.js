/** Client HTTP du socle : même origine que l'interface, jeton de session joint, réponses JSON, erreurs lisibles. */

export class ErreurApi extends Error {
  constructor(message, statut) {
    super(message);
    this.name = "ErreurApi";
    this.statut = statut;
  }
}

let jeton = null;
let surSessionExpiree = () => {};
/** Jeton de session joint à chaque appel (fixé par la session de l'onglet). */
export const definirJeton = (valeur) => void (jeton = valeur);
/** Appelé quand le socle répond 401 : la session est absente ou expirée. */
export const quandSessionExpire = (f) => void (surSessionExpiree = f);

export async function requete(chemin, { methode = "GET", corps } = {}) {
  const entetes = {};
  if (corps !== undefined) entetes["Content-Type"] = "application/json";
  if (jeton) entetes.Authorization = `Bearer ${jeton}`;
  let reponse;
  try {
    reponse = await fetch(chemin, { method: methode, headers: entetes, body: corps === undefined ? undefined : JSON.stringify(corps) });
  } catch {
    throw new ErreurApi("Le socle est injoignable.", 0);
  }
  const json = await reponse.json().catch(() => null);
  if (reponse.status === 401 && jeton) surSessionExpiree();
  if (!reponse.ok) throw new ErreurApi(json?.detail || `Erreur ${reponse.status}`, reponse.status);
  return json;
}
