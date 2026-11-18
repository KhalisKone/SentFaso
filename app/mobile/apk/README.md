# Application Android « Dites-le-nous une fois »

L'application **ouvre le site en ligne** (`https://hack226.185-193-66-4.sslip.io/frontend/`) dans une fenêtre native.
**Mises à jour silencieuses** : toute mise à jour du site apparaît dans l'application à sa prochaine ouverture, sans réinstallation
ni boutique (le serveur demande au téléphone de revérifier la page à chaque visite). Sans Internet, une page « Pas de connexion »
propose de réessayer.

## Installer sur un téléphone

1. Copier `app/mobile/installer/dites-le-nous-une-fois.apk` sur le téléphone (câble, messagerie, lien).
2. L'ouvrir ; si Android le demande, autoriser l'installation depuis cette source.
3. L'application « Dites-le-nous une fois » apparaît avec la mascotte.

## Reconstruire l'APK (sans rien télécharger : tout vient des caches npm et Gradle du poste)

```bash
cd app/mobile/apk
npm install --offline          # Capacitor 8.6.0 (une version imposée dans "overrides" : celle présente en cache)
npm run apk                    # cap sync + Gradle hors ligne → android/app/build/outputs/apk/debug/app-debug.apk
```

Prérequis du poste : Java 21, le SDK Android (`android/local.properties` : `sdk.dir=…`), Gradle 8.14.3 en cache.

## À savoir

- **Changer d'adresse** : `server.url` dans `capacitor.config.json`, puis `npm run apk` (il faut alors réinstaller l'application).
  Tant que l'adresse ne change pas, rien n'est à refaire : seules les mises à jour du site comptent.
- **Signature** : l'APK est signé avec la clé de débogage du poste, ce qui suffit pour l'installer directement sur un téléphone.
  Pour une diffusion sur une boutique (Play Store), il faudra une clé de publication et une version « release ».
- **Fichiers** : `www/` contient la page « Pas de connexion » ; `android/` est le projet Android généré par Capacitor (icônes et écran
  de démarrage tirés de la mascotte).
