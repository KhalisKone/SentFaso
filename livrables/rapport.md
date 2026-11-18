# Dites-le-nous une fois — Rapport

**Socle d'interopérabilité entre administrations du Burkina Faso**
Faire circuler les pièces entre les administrations plutôt que les usagers entre les guichets, dans le respect de leurs droits sur leurs données.

Démonstrateur en ligne : https://hack226.185-193-66-4.sslip.io/frontend/ · API documentée : https://hack226.185-193-66-4.sslip.io/docs

---

## 1. En bref

| | |
|---|---|
| **Ce que voit l'usager** | Il donne son identifiant unique (NIN) au guichet, rien d'autre. Les pièces sont récupérées auprès des registres. Il n'a rien à accepter ni à régler : dans son espace, il suit ses demandes et voit chaque consultation de ses données. |
| **Ce que fait le socle** | Une passerelle interroge les registres qui détiennent les pièces, avec authentification mutuelle, dans le cadre strict d'un accord (personne, service, finalité, pièces, durée, et base légale quand elle est renseignée), et trace chaque échange dans un journal chaîné. |
| **Résultat** | Trois démarches de bout en bout sans aucune pièce à fournir, vérifiées en local et en ligne ; 76 tests serveur, 18 tests unitaires de l'interface et un parcours complet dans le navigateur, tous verts. |
| **En plus (bonus)** | Un guichet agent complet, la résilience aux pannes des registres, et un assistant (la mascotte) qui répond aux questions et fait des vérifications avec les droits de la personne connectée. |

---

## 2. Architecture

### 2.1 Un dossier par couche

| Couche (imposée) | Dossier | Rôle | Spécification | Tests |
|---|---|---|---|---|
| Registres | `registres/` | Trois registres simulés indépendants (état civil, casier judiciaire, nationalité) + un registre d'identité simulé. Chacun a ses données, son code secret, son catalogue et **ses règles d'accès**. | `registre-*.json` | 8 |
| Passerelle d'échange | `passerelle/` | Branchement des registres, appels signés dans les deux sens, adaptateur, interrogation en parallèle, gestion des pannes. | `passerelle.json` | 27 |
| Consentement et minimisation | `consentement/` | Accord par dossier (service, finalité, pièces, durée) créé à l'ouverture, contrôle avant tout échange, clôture par l'agent, réponses minimales. | `consentement.json` | 7 |
| Journal de traçabilité | `journal/` | Journal unique, chaîné par SHA-256, en ajout seul, scellé, tenu par le serveur. | `journal.json` | 8 |
| Espace usager | `espace-usager/` | Interface React : espace citoyen, guichet agent (bonus), administration. | `espace-usager.json` | 18 + parcours |
| (bonus) Assistant | `assistant/` | Assistant conversationnel (Claude Haiku) : questions sur les démarches, vérifications en lecture seule avec les droits de la personne connectée, historique des conversations. | `assistant.json` | 14 |
| (socle) | `backend/` | Assemblage du serveur : connexion par code, contrôle d'accès par rôle, état du socle. | `socle-complet.json` | 12 |

### 2.2 Schéma

```
   Usager (espace citoyen)          Agent (guichet)            Administrateurs
            │                             │                           │
            └──────────── HTTPS ──────────┴───────────────────────────┘
                                          │
                    ┌─────────────────────▼──────────────────────┐
                    │  SOCLE  (connexion NIN + code, rôles)      │
                    │  ┌──────────────┐  ┌────────────────────┐  │
                    │  │ CONSENTEMENT │◄─┤     PASSERELLE     │  │
                    │  │ accord actif?│  │ annuaire, adapt.,  │  │
                    │  └──────────────┘  │ signatures, pannes │  │
                    │  ┌──────────────┐  └─────────┬──────────┘  │
                    │  │   JOURNAL    │◄───────────┘ chaque      │
                    │  │ chaîné/scellé│              échange     │
                    │  └──────────────┘                          │
                    └──────────────┬──────────────┬──────────────┘
          HMAC dans les deux sens  │              │  contexte : demandeur, dossier, finalité
          ┌────────────────────────┼──────────────┼────────────────────────┐
     ┌────▼─────┐           ┌──────▼─────┐   ┌────▼───────┐        ┌───────▼──────┐
     │ IDENTITÉ │           │ ÉTAT CIVIL │   │  JUSTICE   │        │ NATIONALITÉ  │
     │(ministère│           │  (mairie)  │   │ (tribunal) │        │              │
     └──────────┘           └────────────┘   └────────────┘        └──────────────┘
      Chaque registre garde ses données et décide qui peut l'interroger.
```

### 2.3 Une démarche, pas à pas

1. **Identité** — l'agent saisit le NIN ; le registre d'identité ne renvoie que le nom et les prénoms, pour vérifier la personne en face.
2. **Démarche** — l'agent choisit une démarche prédéfinie ; le guichet affiche, pour chaque pièce, le registre source et la finalité.
3. **Contrôles** — habilitation de l'agent, service actif, démarche active, **finalité** : sans eux, pas d'ouverture. La base légale, facultative, est affichée quand l'admin l'a renseignée.
4. **Accord** — la couche consentement crée l'accord du dossier (service, finalité, pièces, durée), actif dès l'ouverture : le citoyen n'a rien à faire.
5. **Échange** — la passerelle vérifie l'accord, n'interroge que les registres utiles, pour les seules pièces de l'accord ; chaque registre applique ses propres règles.
6. **Résultat par pièce** — transmise ; à choisir (plusieurs registres) ; indisponible (registre en panne : jamais demandée à l'usager, relancée ensuite) ; à fournir (aucun registre ne la détient).
7. **Consultation** — lecture seule, filigrane ; le fichier est ouvert chez le registre par un lien signé de 5 minutes, redemandé à chaque fois et journalisé.
8. **Clôture** — l'accord prend fin, les liens sont effacés, le journal est conservé.

### 2.4 Technologies et hébergement

FastAPI (Python) pour le socle et les registres ; React + Vite pour l'interface ; Firebase Realtime Database pour l'état, les accords et le journal (les pièces ne sont jamais stockées par le socle : elles restent chez les registres). L'assistant utilise Claude Haiku (API Anthropic), appelé par le serveur seulement : la clé ne quitte jamais le serveur. Hébergement sur un VPS partagé : deux services isolés (socle, registres), écoute locale uniquement, HTTPS par Caddy, plafonds mémoire (512 Mo et 256 Mo).

### 2.5 L'assistant (bonus)

La mascotte du socle, un cheval blanc au foulard aux couleurs du drapeau (comme les chevaux des armoiries), est présente sur toutes les pages. Elle ouvre une discussion en langage courant.

- **Sans connexion** : questions générales sur le socle et les démarches ; aucune donnée consultée, rien n'est enregistré.
- **Connecté** : des « compétences » selon le rôle, exécutées par le serveur **avec les droits de la personne** et en lecture seule. Le modèle ne voit que ce que la personne a le droit de voir, et une compétence hors de son rôle est refusée même si le modèle la demande.
- **Aucune action à la place de la personne** (ouvrir un dossier, donner ou retirer un accord, nommer quelqu'un) : l'assistant explique où cliquer.
- **Historique** : les conversations sont enregistrées par personne, et peuvent être reprises ou supprimées.
- **Expert du branchement** : sur la page de branchement, l'assistant connaît tout le contrat, les signatures (et leurs pièges), l'adaptateur, chaque critère du banc et chaque message d'erreur de la plateforme, avec sa cause et sa correction. Un bouton « Demander à l'assistant » accompagne chaque erreur ; la configuration saisie sur la page lui est jointe (jamais le code secret, masqué par le serveur avant tout envoi). Évalué sur 12 erreurs réelles de branchement : 12 bons diagnostics.
- **Garde-fous** : quota de messages (40 par heure connecté, 30 sans connexion), consignes strictes (ne rien inventer, s'appuyer sur les compétences, ne jamais donner de code ni de secret).

| Rôle | Compétences |
|---|---|
| Tous | mes demandes ; qui a consulté mes données ; annuaire des registres ; intégrité du journal |
| Agent | vérifier une identité (journalisé, visible par la personne) ; dossiers du service ; détail d'un dossier ; registres sources des pièces d'une démarche ; démarches du service |
| Admin | démarches du service (finalité, pièces, base légale si renseignée) ; agents du service |
| Super admin | services et branchements ; test des registres (appel signé avec l'identifiant de test, qui ne correspond à personne) |

---

## 3. Démarches couvertes

Trois démarches de bout en bout, **sans aucune pièce à fournir par l'usager** (vérifié automatiquement par le parcours de bout en bout, avec le NIN 99000000000000001) :

| Service demandeur | Démarche | Pièces et registres sources |
|---|---|---|
| Direction des passeports | Demande de passeport | Acte de naissance (état civil) · Certificat de nationalité (nationalité) · **Casier vierge : oui/non** (justice) · **Majeur : oui/non** (état civil) |
| Office national d'identification | Établissement de la CNIB | Acte de naissance · Certificat de nationalité · **Majeur : oui/non** |
| Ministère de la Fonction publique | Candidature à un concours | Acte de naissance · Certificat de nationalité · Extrait de casier judiciaire (bulletin complet, **réservé par le tribunal** aux services autorisés) · **Majeur : oui/non** |

En ligne, ces trois démarches, leurs admins et leurs agents sont créés ; elles ont été vérifiées de bout en bout sur le site le 18/11/2026, avec nos registres simulés. Ceux-ci ont ensuite été **retirés** : les pièces viennent désormais des services réels d'une autre équipe (ministère de la Transition digitale, mairie, tribunal), sans rien changer au socle. Le 18/11/2026, les trois démarches ont de nouveau été vérifiées de bout en bout en ligne avec ces services réels : toutes les pièces obtenues, réponses oui/non comprises, aucune à fournir.

Les cas particuliers sont démontrables : pièce détenue par deux registres (le citoyen choisit), pièce introuvable (le citoyen la charge depuis chez lui), registre en panne (« indisponible », relance automatique), service non autorisé par un registre (refus, journalisé).

---

## 4. Tests d'interopérabilité

Tous les tests se lancent par `outils/tester.sh`, sans Firebase ni réseau extérieur (résultats : `resultats-des-tests.txt`).

| Ensemble | Nombre | Ce qui est vérifié |
|---|---|---|
| Registres | 8 | appel non signé ou mal signé refusé ; réponse signée vérifiable ; types limités à ceux demandés ; règles d'accès propres au registre ; réponses minimales ; liens courts et expiration ; panne simulée |
| Passerelle | 27 | lecture du catalogue au branchement ; **pas d'accord, pas d'échange** ; seules les pièces de l'accord circulent ; un autre service ne peut pas utiliser l'accord ; la règle du registre empêche même l'appel ; réponses oui/non sans la donnée ; lien court puis PDF chez le registre ; panne d'un registre sans bloquer les autres ; **signature usurpée rejetée** ; **registre d'une autre équipe branché grâce à l'adaptateur** ; vérification d'identité minimisée ; journalisation de chaque échange ; **banc de conformité** : un registre qui respecte le contrat est déclaré conforme, un registre laxiste (non signé, qui accepte les appels non signés) est signalé ; santé et banc des registres branchés réservés au super admin, chaque passage journalisé ; fiche d'un service modifiée sans le débrancher ; **suppression d'un service** (code annulé, rôles révoqués, démarches retirées), refusée tant que des dossiers sont ouverts ou s'il est le seul service d'identité, et sans retour possible par un écran resté ouvert ; **épreuve en direct avec un registre au format inconnu** (fiches seules, ni oui/non ni signature) : « majeur » et « casier vierge » calculés par le socle sans transmettre ni journaliser la donnée source, personne inconnue = « inconnu », citoyens de ce registre connectés |
| Consentement | 7 | accord actif dès l'ouverture ; aucune démarche demandée au citoyen ; clôture par l'agent seulement, qui coupe aussitôt l'accès ; conflit d'intérêts ; finalité obligatoire, base légale facultative ; règles pures (contrôle avant échange, minimisation) |
| Journal | 8 | numérotation, horodatage et chaînage par le serveur ; auteur fixé par la session ; modification détectée ; **suppression détectée** (sceau) ; lecture limitée ; casquette « passerelle » réservée |
| Socle | 12 (+1) | connexion par code à usage unique ; réponse neutre ; 3 essais ; jeton falsifié refusé ; chacun ne voit que ce que son rôle permet ; écritures limitées au rôle ; un accord n'est jamais modifiable par l'état ; il reste toujours un super admin ; **stockage libre** : SQLite et PostgreSQL se comportent exactement comme la référence, étape par étape (le cas PostgreSQL se lance avec une base de test) ; mode démonstration annoncé à l'interface (données de test) |
| Assistant | 14 | avec un modèle simulé (aucun appel réel) : chaque rôle n'a que ses compétences ; compétence hors rôle refusée ; vérification d'identité journalisée ; test des registres par le super admin ; historique enregistré puis repris ; sans connexion, aucune compétence et rien d'enregistré ; quota ; message clair si le modèle est indisponible ; modèle choisi dans la configuration : désactivé (pas de mascotte), ou service « compatible OpenAI » avec appel de compétence ; **expert du branchement** sur la page connect (savoir complet, configuration de la page jointe, code secret masqué avant tout envoi) |
| Espace usager | 18 + 11 | règles du noyau ; classement des pièces par la recherche ; fiche de branchement PDF ; recherche en temps réel ; **parcours dans un vrai navigateur** : trois démarches sans pièce, consultations retrouvées par l'usager, aucun paramètre ni bouton d'accord côté citoyen |

**Banc de conformité : la preuve qu'un tiers se branche sans nous.** Avant (ou après) son branchement, un registre lance lui-même le banc depuis la page de branchement, avec son code. Le banc l'appelle comme la passerelle, puis tente des appels qu'il **doit refuser** : non signé, mal signé, au nom d'un autre service, horodatage périmé (rejeu). Il contrôle aussi la signature des réponses, le délai, la liste vide pour l'identifiant de test, le catalogue, l'application des règles d'accès et les réponses oui/non. Il rend un bulletin « conforme / non conforme » (critères obligatoires et recommandés), inscrit au journal. Il n'utilise que l'identifiant de test et un identifiant fictif : aucune donnée de citoyen.

**Résultat réel (18/11/2026)** : le registre d'identité du Ministère de la Transition digitale, développé et hébergé par une autre équipe (Render), passe le banc : **conforme, 7 critères obligatoires sur 7** (réponses signées et vérifiées, appels non signés, mal signés, usurpés ou rejoués refusés, vérification d'identité minimisée). Seul manque un critère recommandé : la publication d'un catalogue.

**Santé des registres.** Le super admin voit en direct, toutes les 30 secondes, chaque registre branché : répond ou non, temps de réponse, signature des réponses ; il peut repasser n'importe quel registre au banc.

**Brancher le registre d'une autre équipe.** La page `/frontend/connect` publie le contrat (route documents obligatoire ; catalogue, réponses minimales et liens courts recommandés ; signatures) ; le registre se branche avec son identifiant et son code, teste chaque route, puis se branche. S'il parle un autre format, l'adaptateur traduit sa réponse (nom du paramètre, chemin de la liste, noms des champs, codes de type) — c'est testé avec un registre « étranger » qui n'utilise ni nos noms ni notre structure.

---

## 5. Conformité à la protection des données personnelles

Repères : la loi burkinabè sur la protection des données à caractère personnel (loi n° 001-2021/AN) et l'autorité de contrôle (CIL). Le démonstrateur applique les principes suivants **dans le code**, et les tests les vérifient.

| Principe | Mise en œuvre | Vérifié par |
|---|---|---|
| **Licéité, finalité** | Chaque démarche déclare sa finalité, sans laquelle la passerelle refuse d'ouvrir le dossier ; l'admin peut y joindre la base légale (texte qui autorise la demande), alors transmise avec l'accord et affichée au citoyen. | test consentement, contrôles du guichet |
| **Finalité déterminée** | L'accord lie une finalité, un service, des pièces, une durée ; il est transmis au registre avec chaque appel. | tests passerelle |
| **Minimisation** | Quand un registre ne sait donner que la donnée (date de naissance, mentions du casier), **le socle calcule lui-même « majeur : oui/non » ou « casier vierge : oui/non » et oublie la donnée** : ni transmise, ni conservée, ni journalisée (pas même son empreinte). Seules les pièces de l'accord circulent ; chaque registre ne reçoit que les types qui le concernent ; « majeur » et « casier vierge » répondus par oui/non sans la date de naissance ni les mentions ; la vérification d'identité ne renvoie que le nom et les prénoms ; le socle ne stocke aucune pièce. | tests passerelle, registres |
| **Accord et droits** | Chaque échange est couvert par l'accord du dossier (service, finalité, pièces, durée), vérifié par la passerelle ; le citoyen n'a rien à accepter, choisit la pièce jointe quand deux registres l'ont, et voit tout. | tests consentement, parcours |
| **Transparence** | « Qui a consulté mes données » : chaque échange et chaque consultation, avec le service, l'agent, la date et la démarche. | parcours de bout en bout |
| **Intégrité, imputabilité** | Journal chaîné et scellé, tenu par le serveur ; auteur fixé par la session ; échanges inscrits par la passerelle elle-même ; modification et suppression détectées. | tests journal |
| **Sécurité** | Connexion par code à usage unique (haché, 5 min, 3 essais) ; jetons signés ; contrôle d'accès par rôle côté serveur ; **séparation administrer / consulter** (admins et super admins ne voient aucun dossier) ; conflit d'intérêts interdit ; authentification mutuelle passerelle ↔ registres ; liens de fichiers signés de 5 minutes ; lecture seule avec filigrane. | tests socle, passerelle |
| **Maîtrise par les détenteurs** | Chaque registre décide quels services peuvent lui demander quoi ; la passerelle respecte ces règles et n'envoie même pas le NIN à un registre qui refuserait. | tests passerelle, registres |
| **Assistant** | Compétences en lecture seule, exécutées avec les droits de la personne connectée ; vérification d'identité réservée aux agents et journalisée ; aucune action à la place de la personne ; sans connexion, aucune donnée consultée. | tests assistant |
| **Durée limitée** | Accord daté et expirant ; clôture qui efface les liens ; pièces déposées conservées 12 mois (paramètre de la maquette). | tests consentement |

---

## 6. Un bien commun réutilisable

Le socle est publié sous **licence EUPL 1.2**, conçue pour les logiciels des administrations publiques : toute administration peut le reprendre, l'installer et l'adapter, sans payer ni dépendre de nous ; une version modifiée et distribuée reste libre. Il est livré **avec ses règles de consentement et de traçabilité** (accord par dossier contrôlé avant chaque échange, minimisation, règles décidées par chaque détenteur, journal chaîné). Ces règles sont écrites dans **« Règles du socle »** (`livrables/regles-du-socle.pdf`) : qui fait quoi, l'accord du dossier et son contrôle, la minimisation, ce qui est journalisé et qui le lit, les règles des détenteurs, la sécurité des échanges, les durées. Le **guide de réutilisation** décrit l'installation, le premier démarrage (premier super admin et service d'identité, en une commande), le branchement des administrations et la liste de contrôle avant la mise en production. **Aucune dépendance imposée** : la base de données se choisit dans la configuration, entre **PostgreSQL** (dont Supabase) et **SQLite**, libres et hébergeables dans le pays, ou Firebase ; un test compare les trois étape par étape, et le parcours complet a été joué sur chacune. Un script transfère les données d'une base à l'autre et vérifie tout. De même, l'assistant se branche sur le modèle de son choix (Claude, Mistral, ou un modèle libre installé sur place), ou se désactive. Les clés restent dans un fichier de configuration jamais publié.

## 7. Positionnement face à UXP

UXP (Cybernetica) est une infrastructure d'échange décentralisée entre organisations (serveurs de sécurité, PKI, messages signés et horodatés). Elle sécurise le transport mais ne définit ni les pièces d'une démarche, ni leur finalité, ni les règles de consentement, ni le parcours de l'usager, ni l'interface de l'agent. Notre socle reprend ses mécanismes essentiels sous une forme légère (données décentralisées, authentification mutuelle, contrôle d'accès décidé par le registre, traçabilité chaînée, transparence citoyenne) et apporte ce qu'UXP ne fait pas : démarches avec finalité (et base légale), accord contrôlé avant chaque échange, réponses minimales, vocabulaire commun des pièces, guichet agent et portail citoyen.

---

## 8. Limites assumées et évolutions

| Limite (démonstrateur) | Évolution prévue |
|---|---|
| SMS simulé : le code est affiché à l'écran | fournisseur SMS (opérateur ou agrégateur), voire PIN / contrôle en agence pour les pièces sensibles |
| Passerelle centrale (point unique) | serveurs de sécurité par administration, pair à pair, à l'échelle nationale |
| Signatures HMAC à secret partagé | certificats (PKI), TLS mutuel, horodatage qualifié |
| NIN commun à tous les registres (risque de recoupement) | identifiants dérivés par service, rapprochés par le seul socle |
| Démonstration en ligne encore sur Firebase (hors du Burkina) | bascule sur PostgreSQL / Supabase : module prêt et testé, script de transfert ; base en cours de création |
| État du socle échangé en un bloc, filtré et fusionné par le serveur | API par ressource (dossiers, rôles, démarches) |
| Pièces déposées par l'usager gardées en mémoire du navigateur | stockage chiffré par service, liens signés |
| Assistant : les résultats des compétences (noms, états des dossiers) sont envoyés à l'API Claude, hors du Burkina | modèle libre hébergé sur place (déjà branchable : « compatible OpenAI »), ou pseudonymisation avant envoi ; assistant désactivable par configuration |
| Historique de l'assistant conservé jusqu'à sa suppression par la personne | durée de conservation fixée et purge automatique |

---

## 9. Livrables

| Livrable | Emplacement |
|---|---|
| Cinq couches, chacune avec sa spécification OpenAPI et ses tests | dossiers `registres/`, `passerelle/`, `consentement/`, `journal/`, `espace-usager/` ; `livrables/specifications-openapi/` ; `livrables/resultats-des-tests.txt` |
| Trois démarches de bout en bout sans pièce | section 3 ; `espace-usager/tests/e2e/parcours.py` |
| Rapport | ce document (`livrables/rapport.pdf`) |
| Vidéo de démonstration « Testez vous-même » (2 min 16) | `livrables/video-demonstration.mp4` |
| Guide de test | `livrables/guide-de-test.pdf` |
| Bonus : guichet agent, résilience, assistant | `espace-usager/` (guichet), section 2.3 (pannes), `assistant/` et section 2.5 |
| Bien commun : licence libre, règles, guide de réutilisation | `LICENCE.md` et `LICENSE` (EUPL 1.2) ; `livrables/regles-du-socle.pdf` ; `livrables/guide-de-reutilisation.pdf` |
