"""Génère un document PDF d'une page (pièce fictive « SPÉCIMEN »), sans dépendance externe."""


def _texte(s: str) -> str:
    """Chaîne PDF en WinAnsi (accents français), parenthèses et barres obliques échappées."""
    brut = s.encode("cp1252", "replace").decode("latin-1")
    return "(" + brut.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)") + ")"


def document(autorite: str, titre: str, lignes: list[tuple[str, str]], reference: str) -> bytes:
    flux = [
        "q 0.937 0.169 0.176 rg 0 812 595 30 re f 0 0.62 0.286 rg 0 0 595 14 re f Q",
        f"BT /F2 11 Tf 50 790 Td {_texte('RÉPUBLIQUE DU BURKINA FASO')} Tj ET",
        f"BT /F1 9 Tf 50 776 Td {_texte('La Patrie ou la Mort, nous Vaincrons')} Tj ET",
        f"BT /F2 12 Tf 50 740 Td {_texte(autorite)} Tj ET",
        f"BT /F2 20 Tf 50 690 Td {_texte(titre)} Tj ET",
        f"BT /F1 10 Tf 50 668 Td {_texte('Référence : ' + reference)} Tj ET",
    ]
    y = 620
    for libelle, valeur in lignes:
        flux.append(f"BT /F1 12 Tf 50 {y} Td {_texte(libelle)} Tj ET")
        flux.append(f"BT /F2 12 Tf 230 {y} Td {_texte(valeur)} Tj ET")
        y -= 26
    flux += [
        "q 0.85 0.85 0.85 rg BT /F2 70 Tf 0.707 0.707 -0.707 0.707 120 250 Tm (SPECIMEN) Tj ET Q",
        f"BT /F1 8 Tf 50 30 Td {_texte('Document fictif généré pour la démonstration « Dites-le-nous une fois ». Aucune valeur légale.')} Tj ET",
    ]
    contenu = "\n".join(flux).encode("latin-1")
    objets = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
        b"<< /Length %d >>\nstream\n" % len(contenu) + contenu + b"\nendstream",
    ]
    sortie, positions = bytearray(b"%PDF-1.4\n"), []
    for i, obj in enumerate(objets, 1):
        positions.append(len(sortie))
        sortie += b"%d 0 obj\n" % i + obj + b"\nendobj\n"
    xref = len(sortie)
    sortie += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objets) + 1)
    sortie += b"".join(b"%010d 00000 n \n" % p for p in positions)
    sortie += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objets) + 1, xref)
    return bytes(sortie)
