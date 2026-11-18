/** Accueil : connexion par identifiant unique, puis choix de l'espace selon les rôles. */
import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import armoiries from "../assets/armoiries.png";
import { useSession, useSocle, useStatutSocle } from "../donnees/hooks.js";
import { session } from "../donnees/session.js";
import { socle } from "../donnees/socle.js";
import { EnTete, PiedDePage } from "../mise-en-page/EnTete.jsx";
import { demanderCode, ouvrirSessionSocle } from "../api/session.js";
import { IU_VALIDE, normaliserIu } from "../noyau/identite.js";
import { ACTEURS } from "../noyau/referentiel.js";
import { nomDe, rolesDe } from "../noyau/selecteurs.js";
import { Bouton } from "../ui/Bouton.jsx";
import { Carte } from "../ui/Carte.jsx";
import { Champ } from "../ui/Champs.jsx";
import { cls } from "../ui/cls.js";
import { Alerte } from "../ui/Signaux.jsx";

/** Connexion en deux étapes : identifiant unique, puis code à usage unique reçu par SMS (affiché à l'écran en démonstration). */
function Connexion() {
  const [saisie, setSaisie] = useState("");
  const [etape, setEtape] = useState("iu"); // iu | code
  const [code, setCode] = useState("");
  const [codeDemo, setCodeDemo] = useState(null);
  const [message, setMessage] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const iu = normaliserIu(saisie);

  const envoyerCode = async (e) => {
    e.preventDefault();
    if (!IU_VALIDE.test(iu)) return setErreur("L'identifiant unique compte 17 chiffres.");
    setEnCours(true);
    try {
      const r = await demanderCode(iu);
      setMessage(r.message);
      setCodeDemo(r.code_demo);
      setEtape("code");
      setErreur(null);
    } catch (err) {
      setErreur(err.message);
    }
    setEnCours(false);
  };

  const ouvrir = async (e) => {
    e.preventDefault();
    setEnCours(true);
    try {
      session.ouvrir(await ouvrirSessionSocle(iu, code));
      await socle.charger();
    } catch (err) {
      setErreur(err.message);
      setEnCours(false);
    }
  };

  return (
    <Carte>
      <h2>Connexion</h2>
      {etape === "iu" ? (
        <form onSubmit={envoyerCode}>
          <p className="sous">Saisissez votre identifiant unique (17 chiffres), inscrit sur votre CNIB. Un code vous sera envoyé par SMS.</p>
          <Champ
            label="Identifiant unique"
            placeholder="17 chiffres"
            maxLength={17}
            inputMode="numeric"
            autoComplete="username"
            value={saisie}
            onChange={(ev) => {
              setSaisie(ev.target.value);
              setErreur(null);
            }}
          />
          <div className="actions">
            <Bouton type="submit" enCours={enCours}>
              Recevoir mon code →
            </Bouton>
          </div>
        </form>
      ) : (
        <form onSubmit={ouvrir}>
          <p className="sous">{message}</p>
          {codeDemo ? (
            <Alerte ton="info">
              Démonstration : aucun SMS n'est envoyé. Votre code est <b className="code-demo">{codeDemo}</b>
            </Alerte>
          ) : null}
          <Champ label="Code reçu (6 chiffres)" placeholder="••••••" maxLength={6} inputMode="numeric" autoComplete="one-time-code" value={code}
            onChange={(ev) => {
              setCode(ev.target.value);
              setErreur(null);
            }} />
          <div className="actions">
            <Bouton type="submit" enCours={enCours}>
              Se connecter →
            </Bouton>
            <Bouton variante="second" onClick={() => { setEtape("iu"); setCode(""); setCodeDemo(null); }}>
              Changer d'identifiant
            </Bouton>
          </div>
        </form>
      )}
      {erreur ? <Alerte ton="ko">{erreur}</Alerte> : null}
    </Carte>
  );
}

function ChoixEspace({ iu }) {
  const etat = useSocle();
  const roles = rolesDe(etat, iu);
  // Un simple citoyen va directement dans son espace.
  if (!roles.length) return <Navigate to="/citoyen" replace />;
  return (
    <Carte>
      <h2>Bonjour {nomDe(etat, iu)}</h2>
      <p className="sous">Choisissez votre espace.</p>
      <div className="espaces">
        {["citoyen", ...roles].map((r) => (
          <Link key={r} className={cls("btn", r === "citoyen" && "second")} to={`/${ACTEURS[r].slug}`}>
            {ACTEURS[r].ico} {ACTEURS[r].libelle}
          </Link>
        ))}
      </div>
    </Carte>
  );
}

export function Accueil() {
  const etat = useSocle();
  const statut = useStatutSocle();
  const iu = useSession()?.iu;
  const connecte = iu && statut === "pret";
  return (
    <>
      <EnTete sousTitre="Portail unique de l'administration" />
      <div className="accueil">
        <section className="heros">
          <img src={armoiries} alt="Armoiries du Burkina Faso" />
          <div className="pays">République du Burkina Faso</div>
          <h1>Dites-le-nous une fois</h1>
          <p>
            Ce sont les documents qui circulent entre les administrations, pas vous entre les guichets. Votre identifiant unique suffit, et vous voyez
            qui consulte vos données.
          </p>
          <div className="devise">La Patrie ou la Mort, nous Vaincrons</div>
          <div className="atouts">
            <span>🔒 Échanges signés</span>
            <span>👁️ Consultations tracées</span>
            <span>📄 Zéro pièce à fournir</span>
          </div>
        </section>
        <section className="contenu">{connecte ? <ChoixEspace iu={iu} /> : <Connexion />}</section>
      </div>
      <PiedDePage />
    </>
  );
}
