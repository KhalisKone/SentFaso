import { useEffect } from "react";
import { useSession, useStatutSocle } from "../donnees/hooks.js";
import { socle } from "../donnees/socle.js";
import { Bouton } from "../ui/Bouton.jsx";
import { EnTete, PiedDePage } from "./EnTete.jsx";

/** Charge l'état visible par la personne connectée avant d'afficher la page (sans session : la page gère la connexion). */
export function AvecSocle({ children }) {
  const statut = useStatutSocle();
  const session = useSession();
  useEffect(() => {
    if (session && socle.statut() === "inactif") socle.charger();
  }, [session]);

  if (!session || statut === "pret") return children;
  return (
    <>
      <EnTete sousTitre="Portail unique de l'administration" />
      <div className="page-attente">
        {statut === "erreur" ? (
          <div className="carte etroite">
            <h2>Le socle est injoignable</h2>
            <p className="sous">Vérifiez votre connexion puis réessayez.</p>
            <Bouton onClick={() => socle.charger()}>Réessayer</Bouton>
          </div>
        ) : (
          <div className="attente">
            <span className="rond-attente grand" aria-hidden />
            Chargement du socle…
          </div>
        )}
      </div>
      <PiedDePage />
    </>
  );
}
