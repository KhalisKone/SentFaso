# Matrice de contribution — Dites-le-nous une fois

Qui a fait quoi, couche par couche, et les briques réutilisées avec leur licence. L'historique Git est publié depuis un seul compte :
cette matrice déclare les contributions réelles de chaque membre.

## 1. Contributions par membre et par couche

Légende : ● réalisé · ◐ contribution · — sans objet

| Couche | SAWADOGO Imaane — plateforme | KONE Aïman — registres et interopérabilité | PITROIPA Soraya — données et bien commun |
|---|---|---|---|
| Registres (obligatoire) | ◐ registres simulés de la démonstration locale | ● registres en ligne : ministère (identité), mairie (état civil), tribunal (justice, nationalité), passeports, ONI ; citoyens fictifs de test | — |
| Passerelle d'échange (obligatoire) | ● branchement, signatures, adaptateur sans code, réponses oui/non | ◐ branchement réel des registres, banc de conformité, retours sur le contrat | — |
| Consentement et minimisation (obligatoire) | ● accord par dossier, contrôle avant échange | ◐ règles d'accès des registres (qui peut demander quoi) | ◐ règles de consentement |
| Journal de traçabilité (obligatoire) | ● journal chaîné et scellé, « Qui a consulté mes données » | — | ◐ conservation du journal en base |
| Espace usager (obligatoire) | ● espaces citoyen, agent, admin, super admin | — | — |
| Guichet agent (bonus) | ● | — | — |
| Résilience (bonus) | ◐ pièce « indisponible », relance automatique | ● disponibilité des registres, répétition de panne en ligne | — |
| Assistant (bonus) | ● | — | — |
| Applications Android, Linux, Windows | ● | — | — |
| Stockage et déploiement | ◐ serveur, déploiement en une commande | ◐ hébergement des registres | ● base PostgreSQL (Supabase), stockage au choix |
| Bien commun | ◐ dépôt public | — | ● licence EUPL, règles du socle, guide de réutilisation |
| Tests d'interopérabilité | ◐ tests automatiques | ● essais réels des 3 démarches en ligne | — |
| Rapport et vidéo | ● vidéo ; ◐ rapport | ◐ rapport (registres, essais) | ◐ rapport (protection des données, bien commun) |
| **Part globale** | **40 %** | **30 %** | **30 %** |

## 2. Briques réutilisées et leur licence

### Dans le code du socle

| Brique | Version | Usage | Licence |
|---|---|---|---|
| FastAPI | 0.163.2 | serveur du socle et des registres | MIT |
| Uvicorn | 0.54.0 | serveur web Python | BSD-3-Clause |
| HTTPX | 0.28.1 | appels aux registres | BSD-3-Clause |
| firebase-admin | 7.8.0 | stockage Firebase (au choix) | Apache-2.0 |
| psycopg | 3.3.9 | stockage PostgreSQL (au choix) | LGPL-3.0 |
| anthropic | 2.10.0 | assistant (facultatif) | Apache-2.0 |
| React, React DOM | 18.3.1 | interface | MIT |
| React Router | 6.28.0 | navigation de l'interface | MIT |
| Vite, @vitejs/plugin-react | 5.4.11, 4.3.4 | construction de l'interface | MIT |
| Vitest | 2.1.8 | tests de l'interface | MIT |
| Capacitor (core, android, cli) | 8.6.0 | application Android | MIT |
| Electron, electron-builder | 33.4.11, 25.1.8 | applications Linux et Windows | MIT |

### Outils (servent à tester ou produire, non distribués avec le code)

| Outil | Version | Usage | Licence |
|---|---|---|---|
| Playwright | 1.58.0 | parcours de bout en bout, PDF des livrables, tournage de la vidéo | Apache-2.0 |
| Pillow | 12.3.0 | images de la vidéo | MIT-CMU |
| Piper (voix fr_FR « siwis ») | 1.8.0 | voix off de la vidéo | GPL-3.0 ou ultérieure (voix : selon sa fiche) |
| FFmpeg | 6.1 | montage de la vidéo | GPL |

### Services en ligne

| Service | Usage | Statut |
|---|---|---|
| Firebase Realtime Database (Google) | base de la démonstration en ligne | propriétaire ; remplaçable par SQLite ou PostgreSQL |
| API Claude (Anthropic) | assistant | propriétaire, facultatif ; remplaçable par un modèle libre (« compatible OpenAI ») |
| Supabase | base PostgreSQL prévue | logiciel libre (Apache-2.0), service hébergé |
| Render | hébergement des registres en ligne | service d'hébergement |

### Données et contenus

| Élément | Origine | Licence |
|---|---|---|
| Citoyens fictifs | générés par `registres/generer.py` | EUPL-1.2 |
| Mascotte, icônes, textes | créés pour le projet | EUPL-1.2 |

## 3. Compatibilité avec la licence du socle (EUPL-1.2)

- Les briques du code sont sous licences permissives (MIT, BSD, Apache-2.0) : compatibles.
- psycopg (LGPL-3.0) est utilisé comme bibliothèque, sans modification : compatible (la LGPL figure dans la liste de compatibilité de l'EUPL).
- Les outils sous GPL (Piper, FFmpeg) servent seulement à produire la vidéo : ils ne sont ni distribués ni liés au code.
- Les services propriétaires (Firebase, API Claude) sont facultatifs et remplaçables : le socle fonctionne entièrement sans eux.
