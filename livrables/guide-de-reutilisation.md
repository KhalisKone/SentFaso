# Réutiliser le socle « Dites-le-nous une fois »

Le socle est un **bien commun** : un socle d'interopérabilité libre, avec ses règles de consentement et de traçabilité,
que toute administration peut reprendre, installer et adapter. Il est publié sous **licence EUPL 1.2**
(voir `LICENCE.md` et `LICENSE` à la racine du dépôt).

Ce guide s'adresse à l'équipe technique d'une administration qui veut l'installer chez elle.

---

## 1. Ce que vous obtenez

| Couche | Dossier | Rôle |
|---|---|---|
| Passerelle d'échange | `passerelle/` | Branchement des administrations, échanges signés dans les deux sens, banc de conformité, santé des registres |
| Consentement et minimisation | `consentement/` | Accord par dossier (service, finalité, pièces, durée), contrôle avant chaque échange, réponses oui/non |
| Journal de traçabilité | `journal/` | Journal unique, chaîné, en ajout seul, tenu par le serveur ; chaque citoyen voit ce qui le concerne |
| Espace usager | `espace-usager/` | Interface : citoyen, guichet agent, admin de service, super admin, page de branchement |
| Socle | `backend/` | Assemblage : connexion par code unique + code SMS, contrôle d'accès par rôle |
| Registres simulés | `registres/` | Pour essayer sans administration réelle (état civil, justice, nationalité, identité) |
| Assistant (facultatif) | `assistant/` | Questions et vérifications en langage courant |

Le socle **ne garde aucune pièce** : elles restent chez les administrations qui les détiennent. Il n'installe rien chez elles :
chacune se branche avec son propre système.

## 2. Ce qu'il faut

- Un serveur Linux avec **Python 3.12** et une adresse en **HTTPS** (derrière un serveur web : Caddy, Nginx…).
- **Node.js** sur le poste qui construit l'interface (pas sur le serveur).
- Une **base de données**, au choix dans `backend/.env` :
  - **PostgreSQL**, y compris **Supabase** (production ; libre, hébergeable dans le pays) ;
  - **SQLite** (essai, petite administration ; un simple fichier, rien à installer) ;
  - Firebase Realtime Database (service de Google), toujours possible.

  Les trois donnent exactement le même résultat : un test les compare étape par étape, et le parcours complet a été joué sur chacune.
- Un **service d'identité** : le registre des codes uniques (17 chiffres) de votre pays, qui saura répondre « valide : oui/non,
  nom, prénoms » (au Burkina Faso : le Ministère de la Transition digitale).
- En production, un **fournisseur de SMS** pour envoyer le code de connexion.
- Facultatif : un **modèle de langue** pour l'assistant, au choix dans `backend/.env` : Claude, ou tout service au format
  « compatible OpenAI » (Mistral, ou un modèle libre installé chez vous avec Ollama). Sans modèle, la mascotte n'apparaît pas.

## 3. Installer

```bash
git clone <adresse du dépôt> socle && cd socle
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
(cd espace-usager && npm ci && npm run build)        # interface → espace-usager/dist
```

Pour un simple essai, une seule commande suffit : `python3 outils/demo_locale.py` (installe ce qui manque, puis lance une démonstration complète avec registres simulés et citoyens fictifs).

Configuration : copier le modèle commenté `backend/.env.exemple` en `backend/.env`, le remplir, puis le rendre lisible
par le service seul (`chmod 600 backend/.env`). Ce fichier n'est jamais publié : le dépôt l'exclut, ainsi que `backend/secrets/`.

| Variable | Rôle | Valeur conseillée en production |
|---|---|---|
| `SOCLE_STOCKAGE` | `postgres` (dont Supabase), `sqlite`, `firebase` | **`postgres`** |
| `DATABASE_URL` | `postgresql://…` (Supabase : chaîne « Session pooler ») ou chemin du fichier SQLite | — |
| `FIREBASE_CREDENTIALS`, `FIREBASE_DB_URL` | seulement si `SOCLE_STOCKAGE=firebase` | — |
| `SOCLE_DEMO` | `1` : démonstration — le code de connexion s'affiche à l'écran et des « données de test » sont proposées | **`0`** |
| `SIGNATURE_REGISTRE_OBLIGATOIRE` | `1` : toute réponse non signée d'une administration est refusée | **`1`** dès que toutes signent |
| `ASSISTANT_FOURNISSEUR` | `aucun`, `anthropic` (Claude) ou `compatible-openai` (Mistral, Ollama…) | au choix |
| `ASSISTANT_URL`, `ASSISTANT_CLE`, `ASSISTANT_MODELE` | adresse du service (compatible OpenAI), clé, nom du modèle | — |

Changer de base sans rien perdre : `outils/transferer_base.py` recopie toutes les données (depuis Firebase ou une copie JSON)
vers PostgreSQL ou SQLite, puis relit et compare tout avant de vous laisser basculer. Il sait aussi faire une copie de sécurité JSON.

Lancer (le serveur web relaie l'adresse publique vers ce port local) :

```bash
cd backend && ../.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8004
```

L'interface est servie sous `/frontend/`, la documentation de l'API sous `/docs`. Les spécifications OpenAPI de chaque couche
sont dans `livrables/specifications-openapi/`.

## 4. Premier démarrage

Sur un socle neuf, personne ne peut se connecter tant que le service d'identité n'est pas branché. Un seul script règle cela :

```bash
cd backend
python3 ../outils/installer_super_admin.py <code unique du super admin> \
    --service-identite "Ministère de la Transition digitale"
```

1. Le script crée le premier super admin et le service d'identité, et affiche **une seule fois** le code de branchement de ce service.
2. Ce code est remis **en privé** à l'équipe du service d'identité, qui se branche sur `/frontend/connect`
   (route des pièces et route de vérification).
3. Le super admin se connecte : code unique, puis code reçu par SMS.

## 5. Brancher les administrations

Pour chaque administration qui détient des pièces (mairie, tribunal…) :

1. **Super admin → Services** : créer le service. Le code s'affiche une seule fois : le copier ou télécharger la **fiche PDF**,
   à remettre en privé.
2. **L'administration** ouvre `/frontend/connect`, saisit son identifiant et son code, puis l'adresse de son système
   (route des pièces ; les autres routes sont proposées). Le contrat à respecter est décrit sur cette page.
3. **« Passer le banc de conformité »** : bulletin conforme / non conforme (réponses signées, appels frauduleux refusés,
   règles d'accès, réponses oui/non), sans rien brancher.
4. **« Brancher mon registre »** : le socle lit ce qu'elle détient et qui peut le demander. C'est **elle** qui décide de ses règles d'accès.
5. Si son système parle un autre format, l'**adaptateur** de la page traduit ses réponses : rien à changer chez elle. S'il ne sait donner que la donnée (date de naissance, mentions du casier), le socle **calcule lui-même** « majeur : oui/non » ou « casier vierge : oui/non » et oublie la donnée ; s'il sert à vérifier les codes uniques sans champ « valide », la simple existence de la fiche suffit.
6. **Super admin → Santé des registres** : chaque administration branchée, en direct.

## 6. Créer les démarches et les comptes

| Rôle | Ce qu'il fait | Ce qu'il ne voit pas |
|---|---|---|
| Super admin | crée, modifie, désactive ou supprime les services, leur remet un code, nomme les admins, suit la santé des registres et le journal global | aucun dossier |
| Admin de service | crée et modifie les démarches (finalité, pièces, base légale facultative), nomme les agents | aucun dossier |
| Agent | ouvre les dossiers au guichet avec le code unique du citoyen, consulte les pièces en lecture seule | les autres services |
| Citoyen | suit ses demandes, choisit une pièce si deux administrations l'ont, dépose une pièce introuvable, voit qui a consulté ses données | les dossiers des autres |

Ajouter un type de pièce au vocabulaire commun : `espace-usager/src/noyau/referentiel.js` (`TYPES_PIECE`) et
`passerelle/conformite.py` (`VOCABULAIRE`), puis reconstruire l'interface.

## 7. Les règles fournies avec le socle

- **Consentement et minimisation** : chaque dossier a un accord (service, finalité, pièces, durée) ; la passerelle le vérifie
  avant chaque échange ; seules les pièces de la démarche circulent ; « majeur » et « casier vierge » sont répondus par oui/non.
- **Règles des détenteurs** : chaque administration décide quels services peuvent lui demander quoi.
- **Traçabilité** : chaque échange et chaque consultation sont inscrits au journal, que le citoyen consulte dans son espace.
- **Sécurité** : échanges signés dans les deux sens, liens de consultation de 5 minutes, contrôle d'accès par rôle sur le serveur.

## 8. Avant la mise en production

- [ ] `SOCLE_DEMO=0`, et envoi du code par SMS branché dans `backend/session.py` (route `/session/code` : le code y est créé).
- [ ] `SIGNATURE_REGISTRE_OBLIGATOIRE=1` quand toutes les administrations signent leurs réponses (vérifier dans « Santé des registres »).
- [ ] Base PostgreSQL (`SOCLE_STOCKAGE=postgres`), sauvegardée régulièrement ; HTTPS ; fichier `backend/.env` lisible par le service seul.
- [ ] Codes de branchement remis en privé ; en cas de fuite, « Nouveau code » (l'ancien cesse aussitôt de fonctionner).
- [ ] Tous les tests au vert : `outils/tester.sh`.

## 9. Contribuer

Une version modifiée et distribuée reste sous EUPL, avec son code source : les améliorations profitent à toutes les administrations.
