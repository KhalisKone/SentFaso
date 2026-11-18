import { Link, useNavigate } from "react-router-dom";
import { useReseau, useSocle } from "../donnees/hooks.js";
import { coffre } from "../donnees/fichiers.js";
import { session } from "../donnees/session.js";
import { socle } from "../donnees/socle.js";
import { basculerReseau } from "../metier/depots.js";
import { ACTEURS, libRole } from "../noyau/referentiel.js";
import { nomDe, nomService } from "../noyau/selecteurs.js";
import { Bouton, BoutonLien } from "../ui/Bouton.jsx";
import { cls } from "../ui/cls.js";
import { useToast } from "../ui/Toasts.jsx";
import { EnTete, PiedDePage } from "./EnTete.jsx";
import { useEspace } from "./espace.js";

function OutilsDemo() {
  const { enLigne } = useReseau();
  const toast = useToast();
  return (
    <>
      <span className={cls("reseau", !enLigne && "hors")}>
        <span className="pt" />
        {enLigne ? "En ligne" : "Hors ligne"}
      </span>
      <button type="button" onClick={() => basculerReseau(toast)} title="Simule une coupure réseau pour l'épreuve de panne">
        Couper / rétablir le réseau
      </button>
    </>
  );
}

function BandeauHorsLigne() {
  const { enLigne, file } = useReseau();
  if (enLigne) return null;
  return (
    <div className="bandeau hors">
      <b>Réseau coupé.</b> Les dépôts sont mis en file d'attente sur l'appareil et partiront automatiquement au retour du réseau ({file.length} en
      attente).
    </div>
  );
}

function Persona() {
  const etat = useSocle();
  const { acteur, iu, role } = useEspace();
  const navigate = useNavigate();
  const deconnecter = async () => {
    await socle.enregistrerMaintenant(); // rien ne se perd : la dernière modification part avant la fermeture
    session.fermer();
    socle.vider();
    coffre.vider();
    navigate("/");
  };
  return (
    <div className="persona">
      Connecté : <span className="qui">{nomDe(etat, iu)}</span> <span className="mono">{iu}</span>
      {role ? (
        <span>
          — {libRole(acteur)} {role.code}
          {role.service ? ` — ${nomService(etat, role.service)}` : ""}
        </span>
      ) : null}
      <BoutonLien variante="second" petit to="/">
        Changer d'espace
      </BoutonLien>
      <Bouton variante="second" petit onClick={deconnecter}>
        Se déconnecter
      </Bouton>
    </div>
  );
}

function Menu({ modules, moduleActif }) {
  const etat = useSocle();
  const { acteur, iu } = useEspace();
  const slug = ACTEURS[acteur].slug;
  return (
    <aside>
      <nav aria-label="Menu de l'espace">
        {modules.map((m) => {
          const nb = m.compteur?.(etat, iu) || 0;
          const actif = m.id === moduleActif;
          return (
            <Link key={m.id} to={`/${slug}/${m.id}`} className={cls("lien", actif && "actif")} aria-current={actif ? "page" : undefined}>
              {m.libelle}
              {nb ? <span className="nb">{nb}</span> : null}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

/** Cadre commun aux quatre espaces : en-tête, bandeau de la personne, menu latéral, contenu. */
export function CadreEspace({ modules, moduleActif, children }) {
  const { acteur } = useEspace();
  return (
    <>
      <EnTete sousTitre={ACTEURS[acteur].titre}>
        <OutilsDemo />
      </EnTete>
      <BandeauHorsLigne />
      <Persona />
      <main className={cls(!modules && "sans-menu")}>
        {modules ? <Menu modules={modules} moduleActif={moduleActif} /> : null}
        <section className="contenu">{children}</section>
      </main>
      <PiedDePage devise />
    </>
  );
}
