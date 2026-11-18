/** Espace admin de service : démarches, agents, journal du service. L'admin ne voit aucun dossier. */
import { useState } from "react";
import { useSocle } from "../../donnees/hooks.js";
import { useEspace } from "../../mise-en-page/espace.js";
import { basculerDemarche, creerDemarche, modifierDemarche } from "../../metier/demarches.js";
import { TYPES_PIECE } from "../../noyau/referentiel.js";
import { nomService } from "../../noyau/selecteurs.js";
import { FormNomination, TableRoles } from "../../composants/Roles.jsx";
import { TableJournal } from "../../composants/TableJournal.jsx";
import { Bouton } from "../../ui/Bouton.jsx";
import { Carte, EnTetePage, Vide } from "../../ui/Carte.jsx";
import { Champ, Coche } from "../../ui/Champs.jsx";
import { AucunResultat, BarreRecherche, useRecherche } from "../../ui/Recherche.jsx";
import { Pastille, Retour } from "../../ui/Signaux.jsx";
import { Modale } from "../../ui/Modale.jsx";
import { Tableau } from "../../ui/Tableau.jsx";
import { useToast } from "../../ui/Toasts.jsx";

// ── Démarches ────────────────────────────────────────────────────────────────
const FORMULAIRE_VIDE = { nom: "", finalite: "", base_legale: "", pieces: [], duree: 30 };

/** Champs d'une démarche, communs à la création et à la modification. */
function ChampsDemarche({ f, setF }) {
  const champ = (cle) => (e) => setF({ ...f, [cle]: e.target.value });
  const basculerPiece = (t) => setF({ ...f, pieces: f.pieces.includes(t) ? f.pieces.filter((x) => x !== t) : [...f.pieces, t] });
  return (
    <>
      <Champ label="Nom" placeholder="Ex. : Candidature au concours direct" value={f.nom} onChange={champ("nom")} />
      <Champ label="Finalité (montrée au citoyen)" placeholder="Ex. : vérifier les conditions d'inscription au concours" value={f.finalite} onChange={champ("finalite")} />
      <Champ label="Base légale (texte qui autorise la demande, facultatif)" placeholder="Ex. : Décret n° 2023-0412 portant organisation des concours" value={f.base_legale} onChange={champ("base_legale")} />
      <label>Pièces à fournir</label>
      {Object.entries(TYPES_PIECE).map(([t, libelle]) => (
        <Coche key={t} checked={f.pieces.includes(t)} onChange={() => basculerPiece(t)}>
          {libelle}
        </Coche>
      ))}
      <Champ label="Durée de validité de l'accord (jours)" type="number" min={1} max={365} value={f.duree} onChange={champ("duree")} />
    </>
  );
}

function FormDemarche() {
  const { role } = useEspace();
  const [f, setF] = useState(FORMULAIRE_VIDE);
  const [resultat, setResultat] = useState(null);

  const valider = (e) => {
    e.preventDefault();
    const r = creerDemarche(role, f);
    setResultat(r);
    if (r.ok) setF(FORMULAIRE_VIDE);
  };

  return (
    <Carte titre="Créer une démarche" etroite>
      <form onSubmit={valider}>
        <ChampsDemarche f={f} setF={setF} />
        <div className="actions">
          <Bouton type="submit">Créer la démarche</Bouton>
        </div>
      </form>
      <Retour resultat={resultat} />
    </Carte>
  );
}

function ModaleDemarche({ id, demarche, onFermer }) {
  const { role } = useEspace();
  const toast = useToast();
  const [f, setF] = useState({ nom: demarche.nom, finalite: demarche.finalite, base_legale: demarche.base_legale || "",
                               pieces: [...(demarche.pieces || [])], duree: demarche.duree || 30 });
  const [resultat, setResultat] = useState(null);
  const valider = (e) => {
    e.preventDefault();
    const r = modifierDemarche(role, id, f);
    if (r.ok) {
      toast(r.msg);
      onFermer();
    } else setResultat(r);
  };
  return (
    <Modale titre={`Modifier — ${demarche.nom}`} onFermer={onFermer}>
      <form onSubmit={valider}>
        <ChampsDemarche f={f} setF={setF} />
        <p className="sous">La modification vaut pour les prochains dossiers ; ceux déjà ouverts gardent leurs pièces.</p>
        <div className="actions">
          <Bouton type="submit">Enregistrer</Bouton>
          <Bouton variante="second" onClick={onFermer}>
            Annuler
          </Bouton>
        </div>
      </form>
      <Retour resultat={resultat} />
    </Modale>
  );
}

export function Demarches() {
  const etat = useSocle();
  const { role } = useEspace();
  const [edition, setEdition] = useState(null);
  const ds = Object.entries(etat.demarches[role.service] || {});
  const recherche = useRecherche(ds, ([id, d]) => [id, d.nom, d.finalite, d.base_legale || "base légale non renseignée", d.pieces.map((t) => TYPES_PIECE[t]),
    d.statut === "active" ? "active" : "désactivée"]);
  return (
    <>
      <EnTetePage titre={`Démarches — ${nomService(etat, role.service)}`}>
        Chaque démarche fixe la finalité, les pièces demandées et, si vous la renseignez, la base légale. L'agent n'a plus qu'à la choisir.
      </EnTetePage>
      <FormDemarche />
      <Carte>
        {ds.length ? (
          <>
          <BarreRecherche recherche={recherche} total={ds.length} placeholder="Rechercher : démarche, pièce, base légale…" />
          <Tableau entetes={["Démarche", "Base légale", "Pièces", "Durée", "Statut", ""]}>
            {recherche.resultats.map(([id, d]) => (
              <tr key={id}>
                <td>
                  <b>{d.nom}</b>
                  <br />
                  <small className="sous">{d.finalite}</small>
                </td>
                <td>
                  {d.base_legale ? (
                    <small>{d.base_legale}</small>
                  ) : (
                    <>
                      <small className="sous">non renseignée</small>
                      <br />
                      <button type="button" className="lien-texte" onClick={() => setEdition(id)}>
                        Ajouter
                      </button>
                    </>
                  )}
                </td>
                <td>
                  {d.pieces.map((t) => (
                    <div key={t}>{TYPES_PIECE[t]}</div>
                  ))}
                </td>
                <td>{d.duree} j</td>
                <td>{d.statut === "active" ? <Pastille ton="ok">active</Pastille> : <Pastille ton="ko">désactivée</Pastille>}</td>
                <td>
                  <Bouton variante="second" petit onClick={() => setEdition(id)}>
                    Modifier
                  </Bouton>{" "}
                  <Bouton variante={d.statut === "active" ? "danger" : "second"} petit onClick={() => basculerDemarche(role, id)}>
                    {d.statut === "active" ? "Désactiver" : "Réactiver"}
                  </Bouton>
                </td>
              </tr>
            ))}
            {recherche.resultats.length ? null : <AucunResultat colonnes={6} recherche={recherche} />}
          </Tableau>
          </>
        ) : (
          <Vide>Aucune démarche.</Vide>
        )}
      </Carte>
      {edition ? <ModaleDemarche id={edition} demarche={etat.demarches[role.service][edition]} onFermer={() => setEdition(null)} /> : null}
    </>
  );
}

// ── Agents ───────────────────────────────────────────────────────────────────
export function Agents() {
  const etat = useSocle();
  const { role } = useEspace();
  const agents = etat.roles.filter((x) => x.role === "agent" && x.service === role.service);
  return (
    <>
      <EnTetePage titre={`Agents — ${nomService(etat, role.service)}`}>
        L'admin gère les comptes de son service. Il ne voit pas les dossiers des citoyens.
      </EnTetePage>
      <FormNomination
        titre="Créer un agent"
        role="agent"
        service={role.service}
        libelleIu="Identifiant unique de l'agent"
        bouton="Créer l'agent"
        succes={(code) => `Agent ${code} créé. Il peut ouvrir son espace agent.`}
      />
      <TableRoles roles={agents} action="suspendre" />
    </>
  );
}

// ── Journal du service ───────────────────────────────────────────────────────
export function JournalService() {
  const etat = useSocle();
  const { role } = useEspace();
  const lignes = etat.journal
    .filter(
      (l) =>
        (l.service === role.service && l.casquette === "admin") ||
        (l.service === role.service && l.casquette === "agent" && /refus|Mot de passe/.test(l.action)),
    )
    .reverse();
  return (
    <>
      <EnTetePage titre="Journal du service">Actions d'administration du service (sans le contenu des dossiers).</EnTetePage>
      <TableJournal lignes={lignes} />
    </>
  );
}
