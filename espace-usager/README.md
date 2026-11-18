# Interface web (React)

Interface du socle « Dites-le-nous une fois » : accueil, espaces citoyen, agent, admin, super admin et branchement des services.
React 18 + React Router 6, construite avec Vite. Servie par le backend FastAPI sous `/frontend`.

## Commandes

```bash
npm install
npm run dev     # http://localhost:5173/frontend/ — l'API est relayée vers le backend (SOCLE_URL, par défaut http://127.0.0.1:8100)
npm run build   # produit dist/, que le backend sert sous /frontend
```

## Architecture

Les couches ne dépendent que des couches situées au-dessus d'elles dans cette liste.

| Dossier | Rôle |
|---|---|
| `src/api/` | Appels HTTP au backend : `/etat` (état du socle) et `/connect` (passerelle d'échange). |
| `src/noyau/` | Règles pures, sans React ni réseau : référentiel (types de pièces, statuts), identité, journal chaîné, sélecteurs. |
| `src/donnees/` | Stores hors React (état du socle, session, réseau simulé, fichiers déposés) et leurs hooks (`useSyncExternalStore`). |
| `src/metier/` | Cas d'usage, chacun journalisé : identité, annuaire (quel registre délivre quelle pièce), recherche des pièces auprès des registres, consentement, dossiers (contrôles de la passerelle, consultation, clôture), dépôts, nominations, services, démarches. |
| `src/ui/` | Composants de base : boutons, cartes, champs, pastilles, tableau, modale, toasts. |
| `src/mise-en-page/` | En-tête, pied de page, cadre des espaces (bandeau de la personne, menu), chargement. |
| `src/composants/` | Blocs partagés entre espaces : journal, rôles et nominations, visionneuse de pièce. |
| `src/pages/` | Une page par écran. `espaces.js` déclare les modules (menu) de chaque espace. |
| `src/styles/theme.css` | Charte aux couleurs du Burkina Faso (verre dépoli, coins arrondis). |

## Routes

| Route | Écran |
|---|---|
| `/frontend/` | Accueil et connexion par identifiant unique |
| `/frontend/connect` | Branchement d'un service (contrat d'API, test, branchement) |
| `/frontend/citoyen/:module` | Mes demandes, pièces à fournir, mes documents, qui a consulté mes données |
| `/frontend/agent/:module/:dossier?` | Nouveau dossier, dossiers du service, détail d'un dossier |
| `/frontend/admin/:module` | Démarches, agents, journal du service |
| `/frontend/super-admin/:module` | Services, admins, super admins, journal global |

## À savoir

- L'état complet est relu depuis `/etat` à l'ouverture, à l'entrée dans un espace et au retour sur l'onglet, puis réécrit (PUT) 200 ms après chaque modification.
- Le journal est tenu par le serveur (`/journal`) : en ajout seul, chaîné par SHA-256, avec un sceau (nombre de lignes, dernière empreinte) qui détecte aussi les suppressions. L'interface envoie des lignes ; le serveur les numérote, les horodate et les scelle. Il n'est jamais réécrit avec l'état (`/etat`).
- Chaque échange avec un registre est inscrit par la passerelle elle-même (casquette « passerelle », refusée aux navigateurs) : registre, service demandeur, dossier, état de la signature, empreinte de la réponse.
- Authentification mutuelle : la passerelle signe ses appels (`X-Socle-Signature`) et vérifie la signature des réponses (`X-Registre-Signature`). Une signature fausse est rejetée ; une réponse non signée est acceptée et marquée tant que `SIGNATURE_REGISTRE_OBLIGATOIRE` n'est pas à 1.
- Tests sans toucher à Firebase : lancer le backend avec `SOCLE_STOCKAGE=copie` (base lue une fois, écritures en mémoire).
- Les fichiers déposés par le citoyen restent en mémoire dans la maquette : ils ne survivent pas à un rechargement.

## Parcours d'un dossier

1. L'agent saisit le NIN ; le registre d'identité renvoie le nom pour la vérification en face.
2. Il choisit une démarche : le guichet affiche, pour chaque pièce, le registre source (annuaire) et la finalité.
3. La passerelle contrôle l'habilitation de l'agent, le service, la démarche, la finalité et la base légale, puis ouvre le dossier. Le citoyen est prévenu (SMS simulé).
4. Si le citoyen a activé « Demander mon accord » (Paramètres, désactivé par défaut), rien n'est échangé avant son accord. Sinon, les registres sont interrogés tout de suite.
5. Chaque pièce est : transmise (un registre la détient), à choisir par le citoyen (plusieurs), indisponible (registre en panne : jamais demandée au citoyen, relancée automatiquement à l'ouverture du dossier et à la demande), ou à fournir (aucun registre ne la détient).
6. L'agent consulte en lecture seule, avec filigrane ; chaque consultation est visible par le citoyen. Refus, retrait d'accord, expiration et clôture coupent l'accès.
