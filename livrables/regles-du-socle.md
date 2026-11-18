# Règles du socle « Dites-le-nous une fois »

Les règles de consentement et de traçabilité livrées avec le socle. Elles sont **appliquées par le code** (et vérifiées par les tests),
pas seulement écrites. Une administration qui réutilise le socle les reprend telles quelles ou les adapte (section 9).
Licence : EUPL 1.2.

---

## 1. Principes

1. Les pièces circulent entre les administrations, pas l'usager entre les guichets : il ne donne que son **code unique**.
2. **Ne transmettre que l'utile** : seules les pièces de la démarche, et des réponses oui/non quand elles suffisent.
3. **Chaque administration garde ses données** et décide qui peut lui demander quoi.
4. **Tout est tracé**, et chacun voit ce qui concerne ses données.
5. Le socle **ne garde aucune pièce** : il les fait circuler.

## 2. Qui fait quoi

| Rôle | Peut | Ne peut pas |
|---|---|---|
| Super admin | créer, modifier, désactiver, supprimer les services ; remettre leurs codes ; nommer les admins ; suivre la santé des registres et le journal global | voir un dossier |
| Admin de service | créer et modifier les démarches de son service ; nommer, suspendre ses agents | voir un dossier |
| Agent | vérifier l'identité de la personne présente ; ouvrir, consulter (lecture seule) et clôturer les dossiers de son service | ouvrir un dossier qui le concerne ; voir ceux des autres services |
| Citoyen | en lecture seule : suivre ses demandes ; voir qui a consulté ses données | voir les dossiers des autres |
| Administration détentrice (registre) | décider quels services peuvent lui demander chaque pièce ou réponse | — |

## 3. Règles de consentement : l'accord du dossier

Aucun échange n'a lieu sans un **accord**, créé par l'agent à l'ouverture du dossier, qui fixe :

| Élément | Règle |
|---|---|
| Personne | le code unique du citoyen ; l'agent ne peut pas ouvrir un dossier qui le concerne (conflit d'intérêts) |
| Service | le seul service de l'agent ; un autre service ne peut pas s'en servir |
| Finalité | **obligatoire** : sans elle, pas d'ouverture ; montrée au citoyen |
| Base légale | texte qui autorise la demande ; **facultative**, transmise et affichée quand elle est renseignée |
| Pièces | la liste fermée de la démarche : rien d'autre ne peut être demandé |
| Durée | celle de la démarche (30 jours par défaut, de 1 à 365) ; au-delà, l'accord expire |

Avant **chaque** échange, la passerelle contrôle l'accord et refuse (refus journalisé) si : il n'y a pas d'accord ; il concerne une autre
personne ; il a été donné à un autre service ; il n'est pas actif (clos ou expiré) ; la pièce demandée n'en fait pas partie.
L'agent met fin à l'accord en **clôturant** le dossier : les liens sont effacés, le journal est conservé.

Le citoyen n'a rien à accepter ni à régler : il voit chaque échange dans son espace (section 5).

## 4. Règles de minimisation

- Chaque administration ne reçoit que les pièces qui la concernent, pour les seules pièces de l'accord.
- **Réponses oui/non** : « majeur » et « casier vierge » sont répondus par oui/non, sans la date de naissance ni les mentions du casier.
  Si une administration ne sait donner que la donnée, **le socle calcule lui-même la réponse et oublie la donnée** : ni transmise au
  service, ni conservée, ni journalisée (pas même son empreinte).
- La vérification d'identité ne renvoie que le nom et les prénoms.
- Le socle ne stocke aucune pièce. L'agent consulte en **lecture seule, avec filigrane**, par un lien signé redemandé à chaque consultation.
- Une administration qui refuse un service n'en reçoit même pas l'identifiant unique.

## 5. Règles de traçabilité

**Ce qui est inscrit au journal** : chaque échange avec une administration (pièces, réponses oui/non, liens de consultation), chaque
consultation d'une pièce par un agent, chaque vérification d'identité, chaque refus, chaque connexion, et chaque action d'administration
(services et démarches créés, modifiés, supprimés ; nominations ; codes remis ; passages au banc de conformité).

**Qui l'inscrit** : le serveur. Les échanges sont inscrits par la passerelle elle-même ; l'auteur d'une ligne est fixé par la session,
jamais par l'écran.

**Comment** : un seul journal, en **ajout seul**, numéroté et horodaté par le serveur ; chaque ligne est **chaînée** à la précédente
(empreinte SHA-256) et l'ensemble est **scellé**. Une ligne modifiée ou effacée est détectée (« Vérifier l'intégrité »).

**Qui le lit** :

| Qui | Lit |
|---|---|
| Citoyen | toutes les lignes qui concernent ses données (« Qui a consulté mes données ») |
| Chacun | les lignes dont il est l'auteur |
| Admin de service | l'administration de son service et les refus qui le concernent |
| Super admin | tout le journal (qui ne contient que des références, jamais le contenu d'une pièce) |

## 6. Règles des administrations détentrices

- Chaque administration publie son **catalogue** : ce qu'elle détient, les réponses oui/non qu'elle propose, et **qui peut demander quoi**.
- La passerelle applique ces règles avant tout appel ; l'administration les applique aussi de son côté.
- Elle se branche avec son **code** (remis en privé par le super admin, montré une seule fois) et passe le **banc de conformité**.

## 7. Sécurité des échanges

- Appels de la passerelle **signés** (HMAC-SHA256, horodatage de 5 minutes) ; appels non signés, mal signés, au nom d'un autre service
  ou rejoués refusés par les administrations conformes.
- Réponses des administrations **signées** et vérifiées ; une réponse non signée est acceptée et marquée (période de transition),
  refusée quand `SIGNATURE_REGISTRE_OBLIGATOIRE=1`.
- Connexion par code unique + code à usage unique (envoyé par SMS ; affiché à l'écran en démonstration).

## 8. Durées

| Élément | Durée | Appliquée par |
|---|---|---|
| Code de connexion | 5 minutes, 3 essais, 5 envois par 10 minutes | le serveur |
| Session | 8 heures | le serveur |
| Lien de consultation d'une pièce | 5 minutes (15 minutes pour un lien joint à une liste) | l'administration qui détient la pièce |
| Accord d'un dossier | durée de la démarche (30 jours par défaut) | la passerelle |
| Journal | sans limite (preuve) | à fixer par l'administration, selon la loi |
| Conversations de l'assistant | jusqu'à leur suppression par la personne | à fixer par l'administration |

## 9. Adapter les règles (réutilisation)

| Règle | Où |
|---|---|
| Contrôle de l'accord, durée, clôture | `consentement/regles.py` |
| Droits de chaque rôle | `backend/acces.py` |
| Réponses oui/non calculées, vocabulaire des pièces | `passerelle/adaptateur.py`, `passerelle/conformite.py`, `espace-usager/src/noyau/referentiel.js` |
| Journal, lecture par rôle, intégrité | `journal/api.py` |
| Durées de connexion | `backend/session.py` |

Après toute modification : `outils/tester.sh` (tous les tests doivent rester verts).
