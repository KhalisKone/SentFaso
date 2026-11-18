import { useState } from "react";
import { useSocle } from "../donnees/hooks.js";
import { useEspace } from "../mise-en-page/espace.js";
import { changerStatutRole, nommer } from "../metier/nominations.js";
import { normaliserIu } from "../noyau/identite.js";
import { nomDe, nomService } from "../noyau/selecteurs.js";
import { Bouton } from "../ui/Bouton.jsx";
import { Carte, Vide } from "../ui/Carte.jsx";
import { ChampIu, Selection } from "../ui/Champs.jsx";
import { AucunResultat, BarreRecherche, useRecherche } from "../ui/Recherche.jsx";
import { Pastille, Retour } from "../ui/Signaux.jsx";
import { Mono, Tableau } from "../ui/Tableau.jsx";
import { useToast } from "../ui/Toasts.jsx";

/**
 * Liste des personnes ayant un rôle.
 * action : "revoquer" (révocation définitive) ou "suspendre" (suspension réversible, pour les agents).
 */
export function TableRoles({ roles, avecService, action = "revoquer" }) {
  const etat = useSocle();
  const { role: par } = useEspace();
  const toast = useToast();
  const changer = (id, statut) => {
    const r = changerStatutRole(id, statut, par);
    if (!r.ok) toast(r.msg);
  };
  const recherche = useRecherche(roles, (x) => [nomDe(etat, x.iu), x.iu, x.code, x.service && nomService(etat, x.service), x.par, x.statut]);

  if (!roles.length)
    return (
      <Carte>
        <Vide>Personne.</Vide>
      </Carte>
    );
  return (
    <Carte>
      <BarreRecherche recherche={recherche} total={roles.length} placeholder="Rechercher : nom, identifiant, code, service…" />
      <Tableau entetes={["Personne", "Code", ...(avecService ? ["Service"] : []), "Nommé par", "Statut", ""]}>
        {recherche.resultats.map((x) => (
          <tr key={x.id}>
            <td>
              {nomDe(etat, x.iu)}
              <br />
              <small className="mono">{x.iu}</small>
            </td>
            <td>
              <Mono>{x.code}</Mono>
            </td>
            {avecService ? <td>{nomService(etat, x.service)}</td> : null}
            <td>
              <Mono>{x.par}</Mono>
            </td>
            <td>{x.statut === "actif" ? <Pastille ton="ok">actif</Pastille> : <Pastille ton="ko">{x.statut}</Pastille>}</td>
            <td>
              {x.statut === "actif" ? (
                <Bouton variante="danger" petit onClick={() => changer(x.id, action === "suspendre" ? "suspendu" : "revoque")}>
                  {action === "suspendre" ? "Suspendre" : "Révoquer"}
                </Bouton>
              ) : action === "suspendre" ? (
                <Bouton variante="second" petit onClick={() => changer(x.id, "actif")}>
                  Réactiver
                </Bouton>
              ) : null}
            </td>
          </tr>
        ))}
        {recherche.resultats.length ? null : <AucunResultat colonnes={avecService ? 6 : 5} recherche={recherche} />}
      </Tableau>
    </Carte>
  );
}

/**
 * Formulaire de nomination par identifiant unique.
 * services : liste [id, nom] si le rôle est rattaché à un service choisi ; service : service imposé.
 */
export function FormNomination({ titre = "Nommer", role, services, service, libelleIu, bouton = "Nommer", succes }) {
  const { role: par } = useEspace();
  const [iu, setIu] = useState("");
  const [choix, setChoix] = useState(services?.[0]?.[0] || "");
  const [resultat, setResultat] = useState(null);
  const [enCours, setEnCours] = useState(false);

  const valider = async (e) => {
    e.preventDefault();
    setEnCours(true);
    const r = await nommer({ iu: normaliserIu(iu), role, service: service ?? (services ? choix : null), par });
    setResultat(r.ok ? { ok: true, msg: succes(r.code) } : r);
    if (r.ok) setIu("");
    setEnCours(false);
  };

  return (
    <Carte titre={titre} etroite>
      <form onSubmit={valider}>
        <ChampIu label={libelleIu || "Identifiant unique"} value={iu} onChange={(e) => setIu(e.target.value)} />
        {services ? <Selection label="Service" value={choix} onChange={(e) => setChoix(e.target.value)} options={services} /> : null}
        <div className="actions">
          <Bouton type="submit" enCours={enCours}>
            {bouton}
          </Bouton>
        </div>
      </form>
      <Retour resultat={resultat} />
    </Carte>
  );
}
