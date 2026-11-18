# Services branchés sur la plateforme « Dites-le-nous une fois »

Ce dossier contient les **5 administrations simulées** que j'ai déployées sur Render et branchées sur la plateforme
de l'équipe (https://hack226.185-193-66-4.sslip.io, page `/frontend/connect`). Ce sont elles que la passerelle
interroge pendant les démarches : chaque service garde **ses propres données** (modèle estonien) et ne répond
qu'aux appels signés de la plateforme.

Les 3 démarches (passeport, CNIB, concours de la Fonction publique) ont été validées en ligne par la plateforme le
18/11/2026 avec ces services, sans qu'aucune pièce soit demandée au citoyen.

| Dossier | Administration | Adresse Render | Ce qu'il fournit |
|---|---|---|---|
| `ministere-transition/` | Ministère de la Transition digitale | https://oniservices.onrender.com | base des personnes (identifiant unique = NIN, 17 chiffres) : `/verifier` pour connecter le citoyen, prédicat `majeur` |
| `mairie/` | Mairie de Ouagadougou | https://mairie-de-ouagadougou.onrender.com | `acte_naissance`, `acte_mariage`, `certificat_residence`, prédicat `majeur` |
| `tgi/` | Tribunal de grande instance de Ouagadougou | https://tribunal-de-grande-instance-de-ouagadoug.onrender.com | `certificat_nationalite`, `casier_judiciaire` (accès restreint), prédicat `casier_vierge` |
| `passeports/` | Direction des passeports | https://direction-des-passeports.onrender.com | `photo_identite` (le type `passeport` n'est pas dans la liste de la plateforme) |
| `oni/` | Office national d'identification | https://office-national-identification.onrender.com | fiches d'identité (non transmises), prédicat `majeur`, `/verifier` |

Toutes les données sont **fictives** : NIN `990000000000xxxxx`, PDF marqués « SPÉCIMEN », armoiries, cachets et QR codes
non reproduits, photos d'identité remplacées par des silhouettes dessinées.

## Comment j'ai fait

### 1. Un service = un petit serveur Node.js autonome
- Node 20 ou plus, **aucune dépendance** (`npm install` n'installe rien) : uniquement `node:http` et les Web APIs
  (`Request`, `Response`, `crypto.subtle`).
- Chaque dossier a la même structure :
  - `serveur.js` : le serveur HTTP (Render fournit `PORT`) ;
  - `service.js` : choisit la source des données et monte les routes ;
  - `service.config.json` : l'identité du service (nom, pièces détenues, prédicats, règles d'accès) ;
  - `socle/` : le code commun du contrat (signatures, routes, journal), identique dans les 5 services ;
  - `donnees/` : l'index CSV et les PDF du registre ;
  - `test/` : les tests (`npm test`).
- Les 5 dossiers sont générés à partir d'un même modèle : seul `service.config.json` et les données changent.

### 2. Le contrat de la plateforme
Chaque appel de la plateforme porte `X-Socle-Service`, `X-Socle-Horodatage` (secondes Unix) et `X-Socle-Signature`
= HMAC-SHA256 hexadécimal, clé = code secret du service, message = `horodatage \n GET \n chemin?requête`.
Le service refuse (401) une signature fausse ou un horodatage de plus de 5 minutes.

| Route | Rôle |
|---|---|
| `GET /documents?iu=…&types=…&demandeur=…&dossier=…&finalite=…` | documents du citoyen, limités aux `types` demandés ; **403** si nos règles refusent ce `demandeur` ; `dossier` et `finalite` vont au journal |
| `GET /catalogue` | `{ types, predicats, autorisations }` : ce que le service propose et à qui (`"*"` = tous) |
| `GET /predicat?iu=…&q=majeur` | réponse minimale `{ q, reponse: true / false / null }` **sans transmettre la donnée** (ex. la date de naissance) |
| `GET /lien?iu=…&document=…` | lien court signé vers le PDF, valable 15 min, redemandé à chaque consultation |
| `GET /verifier?iu=…` | (ministère, ONI) `{ valide, nom, prenoms, date_naissance }` si le compte est actif, sinon `{ valide: false }` |
| `GET /fichiers/{id}?exp=…&sig=…` | le PDF lui-même, servi uniquement avec un lien signé non expiré |
| `GET /sante` | état du service, public (robot de disponibilité) |

**Authentification mutuelle** : chaque réponse est signée à son tour par `X-Registre-Horodatage` et
`X-Registre-Signature` = HMAC-SHA256(code secret, `horodatage \n chemin?requête reçu \n SHA-256 du corps envoyé`).
Le JSON est sérialisé une seule fois, et ce sont exactement ces octets qui sont signés puis envoyés.

L'identifiant de test `00000000000000000` reçoit toujours `[]`, `{ valide: false }` ou `reponse: null`.

**Règle d'accès** : le tribunal réserve le bulletin complet du casier (`casier_judiciaire`) à
`direction-des-passeports` et `ministere-de-la-fonction-publique` ; `casier_vierge` et `certificat_nationalite`
restent ouverts à tous.

### 3. Les données
- **Ministère** : la table `public.vouchers` d'un Supabase hébergé (150 personnes ;
  `nin, telephone, nom, prenoms, date_naissance, statut, enregistre_le`). Seuls les comptes `actif` sont confirmés
  par `/verifier` ; le téléphone n'est jamais exposé. Sans Supabase, le service lit `donnees/vouchers.csv`.
- **Mairie, tribunal, passeports, ONI** : données embarquées dans `donnees/` (index CSV + PDF par catégorie).

Personnes de test convenues avec la plateforme :

| NIN | Mairie : acte · majeur | Tribunal : casier · casier vierge · nationalité |
|---|---|---|
| 99000000000000036 | acte · oui | casier · oui · certificat |
| 99000000000000001 | acte · oui | casier · oui · certificat |
| 99000000000000002 | acte · **non** (mineur) | aucun casier · inconnu · certificat |
| 99000000000000017 | acte · oui | casier avec une condamnation fictive · **non** · certificat |

### 4. Le déploiement sur Render
Pour chaque service : **New → Web Service**, ce dépôt, puis :

| Champ | Valeur |
|---|---|
| Root Directory | `services/<dossier>` (ex. `services/mairie`) |
| Build Command | `npm install --omit=dev` |
| Start Command | `node serveur.js` |
| Instance | Free |

Variables d'environnement (jamais dans le dépôt) :

| Variable | Rôle |
|---|---|
| `NODE_VERSION` | `22` |
| `PLATEFORME_SECRET` | code secret **de ce service**, donné par le super admin de la plateforme |
| `PLATEFORME_SERVICE` | identifiant du service sur la plateforme (facultatif ; s'il est rempli, `X-Socle-Service` est contrôlé) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | ministère seulement : la base des personnes. Les autres services n'en ont pas besoin |
| `PLATEFORME_CLE_LIENS` | facultatif : sans elle, la clé des liens de téléchargement est dérivée du code secret |

Vérification : `https://<adresse>/sante` doit répondre `"configure": true` et le bon nombre de pièces.

### 5. Le branchement sur la plateforme
Sur `/frontend/connect`, avec l'identifiant et le code secret du service :
1. route documents `https://<adresse>/documents` → **Tester** (réponse `[]` et « signature vérifiée par la passerelle ») ;
2. route catalogue → **Tester** ; choisir le prédicat proposé (`majeur` ou `casier_vierge`) ;
3. **Passer le banc de conformité**, puis **Brancher mon registre** ;
4. après une modification des règles d'accès : **Relire mon catalogue**.

### 6. Rester éveillé
Une instance Render gratuite s'endort et dépasse alors les 8 s exigées au premier appel. Un moniteur UptimeRobot
appelle le `/sante` de chaque service toutes les 5 minutes (`/sante` répond aussi en `HEAD`).

## Lancer un service en local

```bash
cd services/mairie
PLATEFORME_SECRET=un-secret-de-test node serveur.js      # http://localhost:3000/sante
npm test                                                  # tests du service
```

## Sécurité
- Aucun secret dans le dépôt : chaque dossier ignore `.env` et `.env.*`.
- Comparaison des signatures en temps constant ; horodatage limité à ± 5 minutes.
- Les fichiers ne passent jamais par la plateforme : elle reçoit un lien signé de courte durée.
- Chaque consultation est inscrite dans le journal du service (chaîné SHA-256), avec le demandeur, le dossier et la finalité.

Licence : MIT.
