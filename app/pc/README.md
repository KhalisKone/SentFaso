# Applications de bureau « Dites-le-nous une fois » (Linux, Windows)

Comme l'application Android, elles **ouvrent le site en ligne** (`https://hack226.185-193-66-4.sslip.io/frontend/`) dans une
fenêtre à elles : **toute mise à jour du site y arrive à la prochaine ouverture**, sans réinstallation. Sans Internet, une page
« Pas de connexion » propose de réessayer. Les liens vers d'autres sites s'ouvrent dans le navigateur ; une seule fenêtre à la fois.

| Système | Fichier | Utilisation |
|---|---|---|
| Linux (toutes distributions) | `linux/dites-le-nous-une-fois.AppImage` | le rendre exécutable si besoin (`chmod +x`), puis double-cliquer : rien à installer |
| Linux (Debian, Ubuntu) | `linux/dites-le-nous-une-fois_1.0.0_amd64.deb` | `sudo apt install ./dites-le-nous-une-fois_1.0.0_amd64.deb` : l'application apparaît dans le menu |
| Windows 10 / 11 (64 bits) | `windons/dites-le-nous-une-fois-portable.exe` | double-cliquer : l'application se lance sans installation |

Windows peut afficher « Windows a protégé votre ordinateur » (application non signée) : « Informations complémentaires » →
« Exécuter quand même ».

## Reconstruire (sans rien télécharger : Electron 33.4.11 et les outils de construction viennent des caches du poste)

```bash
cd app/pc/source
npm install --offline
npm run linux       # AppImage + .deb dans dist/
npx electron-builder --win portable --publish never     # .exe portable dans dist/
```

Source : `main.js` (fenêtre, page hors connexion, liens externes), `erreur.html`, icônes `icone.png` / `icone.ico` (mascotte).

## Limites connues

- **Windows** : version **portable** (pas d'installateur). Construire un installateur depuis Linux demande un wine fonctionnel
  (pour le désinstallateur), ce qui n'est pas le cas sur le poste de construction. Pour la même raison, l'exécutable interne garde
  l'icône d'Electron ; la fenêtre affiche bien la mascotte.
- **Non signés** : Windows et certains Linux peuvent demander une confirmation au premier lancement.
