/** Un espace (citoyen, agent, admin, super admin) : contrôle de session et de rôle, puis module demandé. */
import { useEffect, useMemo } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useSession, useSocle } from "../donnees/hooks.js";
import { socle } from "../donnees/socle.js";
import { CadreEspace } from "../mise-en-page/CadreEspace.jsx";
import { ContexteEspace } from "../mise-en-page/espace.js";
import { acteurDuSlug, libRole } from "../noyau/referentiel.js";
import { roleDe } from "../noyau/selecteurs.js";
import { Carte, Vide } from "../ui/Carte.jsx";
import { ESPACES } from "./espaces.js";

export function Espace() {
  const { slug, module, id } = useParams();
  const acteur = acteurDuSlug(slug);
  const iu = useSession()?.iu;
  const etat = useSocle();

  // Données fraîches à l'entrée dans un espace et au retour sur l'onglet (un autre poste a pu écrire).
  useEffect(() => {
    socle.rafraichir();
    const auRetour = () => document.visibilityState === "visible" && socle.rafraichir();
    document.addEventListener("visibilitychange", auRetour);
    return () => document.removeEventListener("visibilitychange", auRetour);
  }, [slug]);

  const role = acteur ? roleDe(etat, iu, acteur) : null;
  const contexte = useMemo(() => ({ acteur, iu, role }), [acteur, iu, role]);

  if (!acteur || !iu) return <Navigate to="/" replace />;

  const modules = ESPACES[acteur];
  const courant = modules.find((m) => m.id === module) || modules[0];
  const autorise = acteur === "citoyen" || role;

  return (
    <ContexteEspace.Provider value={contexte}>
      <CadreEspace modules={autorise ? modules : null} moduleActif={courant.id}>
        {autorise ? (
          <courant.Page id={id} />
        ) : (
          <Carte>
            <Vide>
              Vous n'avez pas le rôle {libRole(acteur).toLowerCase()}. <Link to="/">Retour à l'accueil</Link>
            </Vide>
          </Carte>
        )}
      </CadreEspace>
    </ContexteEspace.Provider>
  );
}
