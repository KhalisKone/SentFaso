"""Convertit un document Markdown en PDF A4 aux couleurs du projet (pandoc puis Chrome sans fenêtre).

Lancer depuis la racine :  python3 outils/md_vers_pdf.py livrables/rapport.md [livrables/guide-de-test.md …]
"""
import subprocess
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

CSS = """
@page { size: A4; }
body { font: 10.3pt/1.5 "Noto Sans", "DejaVu Sans", sans-serif; color: #13201a; }
.bande { height: 6px; background: linear-gradient(90deg,#ef2b2d 0 47%,#fcd116 47% 53%,#009e49 53% 100%); margin-bottom: 14px; border-radius: 3px; }
h1 { font-size: 21pt; margin: 0 0 6px; color: #04502b; }
h2 { font-size: 13.5pt; margin: 20px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #009e49; color: #04502b; page-break-after: avoid; }
h3 { font-size: 11pt; margin: 14px 0 6px; color: #04502b; page-break-after: avoid; }
p { margin: 6px 0; } a { color: #007a3d; text-decoration: none; } hr { border: 0; border-top: 1px solid #dde5df; margin: 14px 0; }
code { font: 8.6pt "DejaVu Sans Mono", monospace; background: #eef5f0; padding: 1px 4px; border-radius: 3px; }
pre { background: #f4f7f5; border: 1px solid #dde5df; padding: 9px 12px; border-radius: 6px; white-space: pre; overflow: hidden; font-size: 7.6pt; line-height: 1.3; page-break-inside: avoid; }
pre code { background: none; padding: 0; font-size: 7.6pt; }
table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 8.9pt; }
tr { page-break-inside: avoid; }
th { background: #e3f1e8; color: #04502b; text-align: left; font-weight: 700; padding: 5px 7px; border-bottom: 2px solid #9fcfb2; }
td { padding: 5px 7px; border-bottom: 1px solid #dde5df; vertical-align: top; }
td code { word-break: break-all; }
ol, ul { margin: 6px 0 6px 18px; padding: 0; } li { margin: 2px 0; }
.pied { margin-top: 18px; font-size: 8pt; color: #55625b; border-top: 1px solid #dde5df; padding-top: 6px; }
"""


def convertir(source: Path):
    corps = subprocess.run(["pandoc", str(source), "-f", "gfm", "-t", "html5"], capture_output=True, text=True, check=True).stdout
    titre = next((l[2:] for l in source.read_text(encoding="utf-8").splitlines() if l.startswith("# ")), source.stem)
    html = (f'<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>{titre}</title><style>{CSS}</style></head>'
            f'<body><div class="bande"></div>{corps}<p class="pied">République du Burkina Faso · Socle d\'interopérabilité « Dites-le-nous une fois »</p></body></html>')
    page_html = Path(tempfile.mkdtemp()) / "document.html"
    page_html.write_text(html, encoding="utf-8")
    cible = source.with_suffix(".pdf")
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path="/usr/bin/google-chrome")
        pg = b.new_page()
        pg.goto(page_html.as_uri())
        pg.pdf(path=str(cible), format="A4", print_background=True, display_header_footer=True, header_template="<span></span>",
               footer_template='<div style="font-size:8px;width:100%;text-align:center;color:#777">page <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
               margin={"top": "15mm", "bottom": "15mm", "left": "14mm", "right": "14mm"})
        b.close()
    print(f"{cible} : {cible.stat().st_size // 1024} Ko")


for chemin in sys.argv[1:]:
    convertir(Path(chemin))
