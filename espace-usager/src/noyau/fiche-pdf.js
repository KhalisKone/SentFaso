/**
 * Fiche de branchement d'un service, en PDF, fabriquée dans le navigateur (le code secret ne repart pas vers le serveur).
 * PDF 1.4 minimal, une page A4, polices standard (Helvetica, Courier) en WinAnsi : aucune bibliothèque nécessaire.
 */

const SPECIAUX = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "œ": 0x9c, "Œ": 0x8c, "Ÿ": 0x9f };

/** Texte → octets WinAnsi (les espaces insécables deviennent des espaces). */
export function octets(texte) {
  return Uint8Array.from([...texte], (c) => {
    if (c === " " || c === " ") return 0x20;
    const n = c.codePointAt(0);
    if (SPECIAUX[c]) return SPECIAUX[c];
    return n < 0x80 || (n >= 0xa0 && n <= 0xff) ? n : 0x3f;
  });
}

const echapper = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);

/** Coupe un texte en lignes d'environ `largeur` points (largeur moyenne d'un caractère ≈ 0,5 × la taille). */
function couper(texte, taille, largeur) {
  const max = Math.floor(largeur / (taille * 0.5));
  const lignes = [];
  let ligne = "";
  for (const mot of texte.split(" ")) {
    if (ligne && (ligne + " " + mot).length > max) {
      lignes.push(ligne);
      ligne = mot;
    } else ligne = ligne ? `${ligne} ${mot}` : mot;
  }
  if (ligne) lignes.push(ligne);
  return lignes;
}

const VERT = "0 0.48 0.24", ROUGE = "0.94 0.17 0.18", JAUNE = "0.99 0.82 0.09", ENCRE = "0.12 0.16 0.14", DOUX = "0.38 0.42 0.4";

/** Assemble les objets PDF et la table des renvois (positions en octets). */
function assembler(contenu, titre) {
  const flux = octets(contenu);
  const objets = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>",
    null, // flux du contenu
    `<< /Title (${echapper(titre)}) /Producer (Dites-le-nous une fois) >>`,
  ];
  const morceaux = [octets("%PDF-1.4\n%âãÏÓ\n")];
  const positions = [];
  let taille = morceaux[0].length;
  const ajouter = (o) => {
    morceaux.push(o);
    taille += o.length;
  };
  objets.forEach((o, i) => {
    positions.push(taille);
    if (o === null) {
      ajouter(octets(`${i + 1} 0 obj\n<< /Length ${flux.length} >>\nstream\n`));
      ajouter(flux);
      ajouter(octets("\nendstream\nendobj\n"));
    } else ajouter(octets(`${i + 1} 0 obj\n${o}\nendobj\n`));
  });
  const xref = taille;
  ajouter(octets(`xref\n0 ${objets.length + 1}\n0000000000 65535 f \n${positions.map((p) => `${String(p).padStart(10, "0")} 00000 n \n`).join("")}`));
  ajouter(octets(`trailer\n<< /Size ${objets.length + 1} /Root 1 0 R /Info 8 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  const pdf = new Uint8Array(taille);
  let p = 0;
  for (const m of morceaux) {
    pdf.set(m, p);
    p += m.length;
  }
  return pdf;
}

/**
 * @param {{nom: string, id: string, secret: string, url: string, le?: Date, par?: string}} fiche
 * @returns {Uint8Array} le fichier PDF
 */
export function ficheBranchementPdf({ nom, id, secret, url, le = new Date(), par }) {
  const ops = [];
  let y = 842;
  const texte = (t, { x = 56, taille = 11, police = "F1", couleur = ENCRE } = {}) =>
    ops.push(`BT /${police} ${taille} Tf ${couleur} rg ${x} ${y} Td (${echapper(t)}) Tj ET`);
  const paragraphe = (t, options = {}) => {
    const taille = options.taille || 11;
    for (const l of couper(t, taille, options.largeur || 483)) {
      texte(l, options);
      y -= taille * 1.45;
    }
  };

  // Bandeau aux couleurs du drapeau
  ops.push(`${ROUGE} rg 0 830 595 12 re f`, `${VERT} rg 0 818 595 12 re f`, `${JAUNE} rg 290 820 15 20 re f`);
  y = 780;
  texte("BURKINA FASO · DITES-LE-NOUS UNE FOIS", { taille: 9, police: "F2", couleur: VERT });
  y -= 30;
  texte("Fiche de branchement", { taille: 24, police: "F2" });
  y -= 22;
  texte(`Service : ${nom}`, { taille: 13 });
  y -= 36;

  // Champs
  const champ = (libelle, valeur, police = "F1") => {
    texte(libelle, { taille: 10, police: "F2", couleur: DOUX });
    y -= 16;
    texte(valeur, { taille: police === "F3" ? 13 : 12, police });
    y -= 26;
  };
  champ("IDENTIFIANT DU SERVICE", id, "F3");
  ops.push(`${JAUNE} rg 50 ${y - 24} 495 40 re f`);
  champ("CODE SECRET", secret, "F3");
  champ("PAGE DE BRANCHEMENT", url);
  champ("REMIS LE", `${le.toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })}${par ? ` par ${par}` : ""}`);

  // Avertissement
  y -= 6;
  const haut = y + 16;
  y -= 4;
  paragraphe("Ce code ne s'affiche qu'une seule fois sur la plateforme.", { police: "F2", couleur: ROUGE, x: 66, largeur: 460 });
  paragraphe(
    "Conservez cette fiche en lieu sûr et ne la remettez qu'au responsable technique du service. Ne l'écrivez jamais dans un dépôt de code, un courriel ou une messagerie. Si elle est perdue ou divulguée, le super admin génère un nouveau code : l'ancien cesse aussitôt de fonctionner.",
    { x: 66, largeur: 460, taille: 10.5 },
  );
  ops.push(`${ROUGE} rg 50 ${y + 6} 4 ${haut - y - 6} re f`);
  y -= 22;

  // Étapes
  texte("Pour se brancher (service qui détient des pièces)", { taille: 13, police: "F2", couleur: VERT });
  y -= 22;
  [
    "1. Écrire le code dans la configuration du service (fichier .env ou variable d'environnement), lisible par lui seul.",
    "2. Signer chaque réponse : X-Registre-Signature = HMAC-SHA256(code, horodatage, chemin?requête, SHA-256 du corps).",
    "3. Ouvrir la page de branchement, saisir l'identifiant et le code, puis l'adresse de la route /documents.",
    "4. « Tester » chaque route (rien n'est enregistré), puis « Brancher mon registre ».",
  ].forEach((e) => {
    paragraphe(e, { taille: 10.5 });
    y -= 4;
  });

  y = 48;
  texte("République du Burkina Faso · Socle d'interopérabilité « Dites-le-nous une fois »", { taille: 8.5, couleur: DOUX });
  return assembler(ops.join("\n"), `Fiche de branchement - ${nom}`);
}

/** Propose le fichier au téléchargement. */
export function telecharger(contenu, nom, type = "application/pdf") {
  const url = URL.createObjectURL(new Blob([contenu], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nom });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
