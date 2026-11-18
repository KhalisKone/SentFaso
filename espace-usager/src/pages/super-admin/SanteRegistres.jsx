/** Santé des registres (super admin) : chaque registre branché est appelé en direct (identifiant de test, appel signé). */
import { useCallback, useEffect, useState } from "react";
import { passerBancRegistre, santeRegistres } from "../../api/connect.js";
import { BulletinConformite } from "../../composants/BulletinConformite.jsx";
import { Bouton } from "../../ui/Bouton.jsx";
import { Carte, EnTetePage, Vide } from "../../ui/Carte.jsx";
import { Modale } from "../../ui/Modale.jsx";
import { AucunResultat, BarreRecherche, useRecherche } from "../../ui/Recherche.jsx";
import { Alerte, Pastille } from "../../ui/Signaux.jsx";
import { Mono, Tableau } from "../../ui/Tableau.jsx";

const ACTUALISATION = 30_000;

function Temps({ ms }) {
  const ton = ms > 3000 ? "ko" : ms > 1000 ? "att" : "ok";
  return <Pastille ton={ton}>{ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`}</Pastille>;
}

export function SanteRegistres() {
  const [registres, setRegistres] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [le, setLe] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const [banc, setBanc] = useState(null); // { nom, resultat?, enCours?, erreur? }

  const actualiser = useCallback(async () => {
    setEnCours(true);
    try {
      setRegistres(await santeRegistres());
      setErreur(null);
      setLe(new Date());
    } catch (e) {
      setErreur(e.message);
    }
    setEnCours(false);
  }, []);
  useEffect(() => {
    actualiser();
    const t = setInterval(actualiser, ACTUALISATION);
    return () => clearInterval(t);
  }, [actualiser]);

  const liste = registres || [];
  const recherche = useRecherche(liste, (r) => [r.nom, r.service, r.repond ? "répond" : "ne répond pas", r.signature && `signature ${r.signature}`]);
  const passer = async (r) => {
    setBanc({ nom: r.nom, enCours: true });
    try {
      setBanc({ nom: r.nom, resultat: await passerBancRegistre(r.service) });
    } catch (e) {
      setBanc({ nom: r.nom, erreur: e.message });
    }
  };
  const enPanne = liste.filter((r) => !r.repond).length;

  return (
    <>
      <EnTetePage titre="Santé des registres">
        Chaque registre branché est appelé en direct, avec l'identifiant de test (aucune donnée de citoyen), toutes les 30 secondes. Le banc de
        conformité vérifie qu'il respecte le contrat : signatures, refus des appels illégitimes, règles d'accès, réponses minimales.
      </EnTetePage>
      {erreur ? <Alerte ton="ko">{erreur}</Alerte> : null}
      <Carte>
        <div className="boite-entete">
          <div className="sous">
            {registres ? `${liste.length} registre(s) branché(s)${enPanne ? ` · ${enPanne} ne répond pas` : " · tous répondent"}` : "Appel des registres…"}
            {le ? ` · mis à jour à ${le.toLocaleTimeString("fr-FR")}` : ""}
          </div>
          <Bouton variante="second" petit onClick={actualiser} enCours={enCours}>
            Actualiser
          </Bouton>
        </div>
        {registres && !liste.length ? <Vide>Aucun registre branché.</Vide> : null}
        {liste.length ? (
          <>
            <BarreRecherche recherche={recherche} total={liste.length} placeholder="Rechercher un registre…" />
            <Tableau entetes={["Registre", "État", "Temps de réponse", "Signature des réponses", "Branché le", ""]}>
              {recherche.resultats.map((r) => (
                <tr key={r.service}>
                  <td>
                    <b>{r.nom}</b> {r.double_api ? <Pastille ton="info">double API</Pastille> : null}
                    <br />
                    <Mono>{r.service}</Mono>
                  </td>
                  <td>{r.repond ? <Pastille ton="ok">répond</Pastille> : <Pastille ton="ko">ne répond pas</Pastille>}
                    {!r.repond ? (
                      <>
                        <br />
                        <small className="sous">{r.http ? `HTTP ${r.http}` : r.detail}</small>
                      </>
                    ) : null}
                  </td>
                  <td>
                    <Temps ms={r.temps_ms} />
                  </td>
                  <td>
                    {r.signature === "vérifiée" ? (
                      <Pastille ton="ok">vérifiée</Pastille>
                    ) : r.signature === "absente" ? (
                      <Pastille ton="att">absente</Pastille>
                    ) : r.signature ? (
                      <Pastille ton="ko">{r.signature}</Pastille>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <small>{r.branche_le ? r.branche_le.replace("T", " à ") : "—"}</small>
                  </td>
                  <td>
                    <Bouton variante="second" petit onClick={() => passer(r)}>
                      Passer au banc
                    </Bouton>
                  </td>
                </tr>
              ))}
              {recherche.resultats.length ? null : <AucunResultat colonnes={6} recherche={recherche} />}
            </Tableau>
          </>
        ) : null}
      </Carte>
      {banc ? (
        <Modale titre={`Banc de conformité — ${banc.nom}`} onFermer={() => setBanc(null)}>
          {banc.enCours ? <p className="sous">Passage au banc : appels signés, puis appels que le registre doit refuser…</p> : null}
          {banc.erreur ? <Alerte ton="ko">{banc.erreur}</Alerte> : null}
          <BulletinConformite resultat={banc.resultat} />
        </Modale>
      ) : null}
    </>
  );
}
