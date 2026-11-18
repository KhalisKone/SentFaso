# Livrables — Dites-le-nous une fois

| Livrable demandé | Fichier(s) | État |
|---|---|---|
| Cinq couches obligatoires, chacune avec sa spécification OpenAPI et ses tests | code : `../registres/`, `../passerelle/`, `../consentement/`, `../journal/`, `../espace-usager/` · spécifications : `specifications-openapi/` · résultats : `resultats-des-tests.txt` | ✅ tous les tests verts |
| Trois démarches de bout en bout, sans pièce à fournir par l'usager | passeport, CNIB, concours — prouvées par `../espace-usager/tests/e2e/parcours.py` (rapport, section 3) | ✅ |
| Rapport : architecture, démarches, tests d'interopérabilité, protection des données | `rapport.pdf` (source : `rapport.md`) | ✅ |
| Vidéo de démonstration (≈ 3 min) : une démarche complète sans pièce, puis l'usager qui retrouve la consultation | `video-demonstration.mp4` (2 min 16, voix off : « Testez vous-même », 5 essais) | ✅ |
| Bonus : guichet agent, résilience, assistant, applications | guichet dans `../espace-usager/` ; pannes : « indisponible », relance automatique ; assistant (mascotte, Claude Haiku) dans `../assistant/` ; applications Android, Linux, Windows dans `../app/` (bouton « ⬇ Télécharger l'application » sur chaque page) | ✅ |
| Guide pour tester en ligne | `guide-de-test.pdf` (source : `guide-de-test.md`) | ✅ |

## Spécifications OpenAPI (`specifications-openapi/`)

| Fichier | Couche |
|---|---|
| `registre-etat-civil.json`, `registre-justice.json`, `registre-nationalite.json`, `registre-identite.json` | Registres (contrat commun) |
| `passerelle.json` | Passerelle d'échange |
| `consentement.json` | Consentement et minimisation |
| `journal.json` | Journal de traçabilité |
| `espace-usager.json` | API de l'espace usager (connexion, état filtré par rôle) |
| `assistant.json` | Assistant (bonus) : questions, compétences selon le rôle, historique |
| `socle-complet.json` | Toutes les routes du socle |

## Bien commun

| | |
|---|---|
| Licence | EUPL 1.2 : `../LICENCE.md` (explications) et `../LICENSE` (texte officiel) |
| Règles de consentement et de traçabilité | `regles-du-socle.pdf` (source : `regles-du-socle.md`) |
| Réutiliser le socle | `guide-de-reutilisation.pdf` (source : `guide-de-reutilisation.md`) |

## Régénérer

```bash
outils/tester.sh                              # tous les tests → recopier la sortie dans resultats-des-tests.txt
.venv/bin/python outils/exporter_openapi.py   # spécifications
python3 outils/md_vers_pdf.py livrables/rapport.md livrables/guide-de-test.md livrables/guide-de-reutilisation.md livrables/regles-du-socle.md
```

La vidéo et les PDF sont remis avec les livrables ; ils ne sont pas publiés dans le dépôt de code (les PDF se régénèrent à partir des fichiers `.md`).
