/**
 * Application de bureau « Dites-le-nous une fois » (Linux, Windows).
 * Elle ouvre le site en ligne : toute mise à jour du site arrive ici à la prochaine ouverture, sans réinstallation
 * (le serveur demande de revérifier la page à chaque visite). Sans Internet : page « Pas de connexion » avec « Réessayer ».
 */
const { app, BrowserWindow, Menu, shell } = require("electron");
const path = require("path");

const SITE = "https://hack226.185-193-66-4.sslip.io/frontend/";
const HOTE = new URL(SITE).host;
const duSite = (url) => {
  try {
    return new URL(url).host === HOTE;
  } catch {
    return false;
  }
};

let fenetre = null;

function ouvrir() {
  fenetre = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    minHeight: 560,
    title: "Dites-le-nous une fois",
    icon: path.join(__dirname, "icone.png"),
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  fenetre.loadURL(SITE);

  // Pas de réseau, serveur injoignable : page locale « Pas de connexion ».
  fenetre.webContents.on("did-fail-load", (_e, code, _desc, url, principal) => {
    if (principal && code !== -3 && !url.startsWith("file:")) fenetre.loadFile(path.join(__dirname, "erreur.html"));
  });
  // Liens vers un autre site : navigateur du système ; le site lui-même reste dans l'application.
  fenetre.webContents.setWindowOpenHandler(({ url }) => {
    if (duSite(url)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
  fenetre.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file:") && !duSite(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
}

// Une seule fenêtre : relancer l'application ramène celle qui est ouverte.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (fenetre) {
      if (fenetre.isMinimized()) fenetre.restore();
      fenetre.focus();
    }
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    ouvrir();
  });
  app.on("window-all-closed", () => app.quit());
}
