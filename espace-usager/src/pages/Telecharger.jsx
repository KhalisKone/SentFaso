/** Télécharger l'application : Android, Linux, Windows. Elles ouvrent le site en ligne : mises à jour automatiques. */
import { EnTete, PiedDePage } from "../mise-en-page/EnTete.jsx";
import { Carte, EnTetePage } from "../ui/Carte.jsx";

const VERSIONS = [
  { icone: "📱", systeme: "Android", fichier: "dites-le-nous-une-fois.apk", taille: "4,8 Mo",
    aide: "Ouvrez le fichier sur le téléphone ; si Android le demande, autorisez l'installation depuis cette source." },
  { icone: "🐧", systeme: "Linux", fichier: "dites-le-nous-une-fois.AppImage", taille: "103 Mo",
    aide: "Rendez le fichier exécutable (clic droit → Propriétés, ou chmod +x), puis double-cliquez : rien à installer." },
  { icone: "🪟", systeme: "Windows 10 / 11", fichier: "dites-le-nous-une-fois-portable.exe", taille: "71 Mo",
    aide: "Double-cliquez : l'application se lance sans installation. Si Windows affiche « Windows a protégé votre ordinateur » : « Informations complémentaires » → « Exécuter quand même »." },
];

export function Telecharger() {
  return (
    <>
      <EnTete sousTitre="Télécharger l'application" />
      <main className="sans-menu page-telecharger">
        <EnTetePage titre="Télécharger l'application">
          Les applications ouvrent le site du socle dans leur propre fenêtre : chaque mise à jour du site y arrive toute seule, sans
          réinstallation. Il faut une connexion Internet.
        </EnTetePage>
        <div className="versions">
          {VERSIONS.map((v) => (
            <Carte key={v.systeme} className="version">
              <div className="version-icone" aria-hidden>{v.icone}</div>
              <h2>{v.systeme}</h2>
              <a className="btn" href={`/telechargements/${v.fichier}`} download>
                Télécharger · {v.taille}
              </a>
              <p className="sous">{v.aide}</p>
            </Carte>
          ))}
        </div>
      </main>
      <PiedDePage />
    </>
  );
}
