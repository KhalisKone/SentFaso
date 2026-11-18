# Tester le socle

Adresse : https://hack226.185-193-66-4.sslip.io/frontend/ · API documentée : https://hack226.185-193-66-4.sslip.io/docs

Les identifiants uniques (NIN, 17 chiffres) doivent exister dans le **registre d'identité** (Ministère de la Transition digitale),
branché en double API. Population fictive : `registres/donnees/personnes.json` (NIN 99000000000000001 à …152 ; certains numéros manquent, ex. 31 et 32).

**Données de test** : en démonstration, le bouton **« 🧪 Données de test »**, sous chaque champ « identifiant unique » (connexion, nouveau dossier, nomination, test d'un calcul), propose les comptes et les personnes de test adaptés à la page ; un clic remplit le champ.

**Connexion (tout le monde)** : saisir le NIN → « Recevoir mon code » → saisir le code à 6 chiffres. En démonstration,
aucun SMS n'est envoyé : le code s'affiche à l'écran. Il est valable 5 minutes, pour 3 essais.

## 0. Super admin

Le premier super admin est 99000000000000001. Pour une installation neuve (remet l'état du socle à zéro) :

```
cd ~/hack226/backend && python3 ../outils/installer_super_admin.py <identifiant unique du super admin>
```

## 1. Super admin → Services

Créer (ou vérifier) les services ; l'identifiant est tiré du nom, il doit correspondre exactement :

| Service | Identifiant exact | Rôle | En ligne (18/11/2026) |
|---|---|---|---|
| Ministère de la Transition digitale (case **Double API**) | `ministere-transition-digitale` | registre d'identité (codes uniques) | branché (autre équipe), conforme au banc |
| Mairie de Ouagadougou | `mairie-de-ouagadougou` | état civil : actes, « majeur : oui/non » | branché (autre équipe) |
| Tribunal de grande instance de Ouagadougou | `tribunal-de-grande-instance-de-ouagadoug` | casier, « casier vierge : oui/non », certificat de nationalité | branché (autre équipe), conforme au banc |
| Direction des passeports | `direction-des-passeports` | demandeur (démarche 1) | — |
| Office national d'identification | `oni` | demandeur (démarche 2) | — |
| Ministère de la Fonction publique | `ministere-de-la-fonction-publique` | demandeur (démarche 3) | — |

L'identifiant est tiré du nom à la création (coupé à 40 caractères) : il faut l'utiliser exactement tel quel pour se brancher.
Chaque service peut être **modifié** (nom, sigle, type, tutelle, ville : il reste branché), **désactivé**, recevoir un **nouveau code**,
ou être **supprimé** (refusé tant que des dossiers du service sont ouverts, ou s'il est le seul service d'identité).
Le code secret de chaque registre est remis à son exploitant, qui l'écrit lui-même dans la configuration du registre (jamais dans un document).

**Déjà fait en ligne le 18/11/2026** : services, admins et agents ci-dessous.

Nommer ensuite un admin par service demandeur (« Admins des services ») :

| Service | Admin | Agent (créé par l'admin) |
|---|---|---|
| Direction des passeports | 99000000000000021 | 99000000000000033 |
| Office national d'identification | 99000000000000022 | 99000000000000034 |
| Ministère de la Fonction publique | 99000000000000023 | 99000000000000035 |

## 2. Chaque registre → /frontend/connect

**État au 18/11/2026** : en ligne, **plus aucun registre simulé**. Les pièces viennent des services d'une autre équipe : le ministère (identité), la mairie et le tribunal sont branchés ; les trois démarches ont été vérifiées en ligne avec eux le 18/11/2026 (code unique 99000000000000036). Nos registres simulés servent aux essais en local (tests automatiques, parcours complet).

Pour brancher un registre : identifiant du service et code secret, puis l'adresse de sa route documents (ex. `https://<adresse du service>/documents`) :
les autres routes sont proposées automatiquement. Tester, puis « Brancher mon registre » : le catalogue et les règles d'accès sont lus chez le registre.

**Banc de conformité** (même page, bouton « Passer le banc de conformité ») : sans rien brancher, le registre reçoit un bulletin conforme / non conforme. Il vérifie les signatures, le refus des appels non signés, mal signés, usurpés ou rejoués, les règles d'accès et les réponses oui/non.

**Santé des registres** (super admin, menu « Santé des registres ») : état de chaque registre branché en direct (répond, temps de réponse, signature) et bouton « Passer au banc » pour chacun.

## 3. Admin de chaque service demandeur : les trois démarches sans pièce à fournir

**Déjà fait en ligne le 18/11/2026**, agents compris.

| Service | Démarche | Pièces | Base légale (facultative, exemple fictif) |
|---|---|---|---|
| Direction des passeports | Demande de passeport | Acte de naissance, Certificat de nationalité, Casier judiciaire vierge : oui/non, Majeur : oui/non | Réglementation des titres de voyage (exemple) |
| Office national d'identification | Établissement de la CNIB | Acte de naissance, Certificat de nationalité, Majeur : oui/non | Réglementation de la CNIB (exemple) |
| Ministère de la Fonction publique | Candidature à un concours | Acte de naissance, Certificat de nationalité, Extrait de casier judiciaire, Majeur : oui/non | Statut général de la fonction publique (exemple) |

Créer ensuite un agent par service.

## 4. Agent

Nouveau dossier : identité (NIN + vérification du nom), démarche (le guichet montre le registre source de chaque pièce),
contrôles de la passerelle, ouverture. Avec 99000000000000001, toutes les pièces arrivent sans rien demander au citoyen.

Les cas ci-dessous dépendent des données du registre branché : ils sont garantis **en local**, avec nos registres simulés (voir le README) ; en ligne, ils dépendent des données des services de l'autre équipe.

| Pour montrer | NIN |
|---|---|
| Démarche complète sans pièce | 99000000000000036, 99000000000000001 |
| « À choisir » (acte chez deux registres) | 99000000000000010 |
| « À fournir » (aucun acte de naissance) | 99000000000000025 |
| Mineur (« majeur : non », pas de casier) | 99000000000000002 |
| Casier non vierge | 99000000000000017 |
| Refus d'un registre | démarche d'un service non autorisé demandant l'extrait de casier complet |
| Panne | en local : console du registre simulé (`/registres/etat-civil/console?jeton=…`) → « Simuler une panne » ; en ligne : un registre arrêté. Pièces « indisponible », jamais demandées au citoyen, relance au retour |

## 4 bis. Épreuve en direct : brancher un registre au format inconnu (ex. ceux du jury)

1. Super admin → Services : créer le service (cocher **Double API** s'il sert aussi à vérifier les codes uniques), remettre la fiche du code.
2. Page de branchement → « Adaptateur » : nom du paramètre portant le code unique, chemin de la liste, correspondance des champs et des types.
   Une adresse peut contenir `{iu}` (ex. `https://…/personnes/{iu}`).
3. **Réponses oui/non calculées par le socle** : si le registre ne répond pas « majeur : oui/non » mais donne la fiche de la personne,
   indiquer l'adresse de la fiche et le champ de la date de naissance (même chose pour le casier et ses mentions), puis
   **« Tester le calcul »** avec le code unique d'une personne du registre : seule la réponse oui/non s'affiche.
4. Identité : si la fiche n'a pas de champ « valide », cocher « reconnue dès que sa fiche existe » (une erreur 404 veut dire « inconnue »).
   Les citoyens de ce registre peuvent alors se connecter : le socle interroge **tous** les services d'identité.
5. « Passer le banc de conformité », puis « Brancher mon registre ». À l'agent ensuite : la pièce « Majeur » s'affiche « Répondu oui
   (donnée source non transmise) », et le citoyen voit dans son journal « calculée par le socle ».

Garder les signatures facultatives : un registre extérieur ne signe pas forcément ses réponses (elles sont alors marquées « non signée »).

## 5. Citoyen

Se connecter : voir ses demandes (rien à accepter ni à régler), choisir une pièce si deux registres l'ont,
puis voir dans « Qui a consulté mes données » chaque échange de la passerelle et chaque consultation de l'agent.

## 6. Assistant (la mascotte)

Bouton rond en bas à droite, sur toutes les pages. « ＋ » ouvre une nouvelle conversation, « 🕘 » l'historique (personne connectée).

| Qui | À demander |
|---|---|
| Sans connexion | « Comment fonctionne le socle ? », « Que dois-je donner au guichet ? » |
| Citoyen (99000000000000001) | « Où en sont mes demandes ? », « Qui a consulté mes données ? », « Quels papiers dois-je encore fournir ? » |
| Agent (99000000000000033) | « Vérifie le NIN 99000000000000036 » (inscrit au journal de la personne), « Mes dossiers en attente de l'accord du citoyen », « D'où viennent les pièces de mes démarches ? » |
| Admin (99000000000000021) | « Quelles démarches propose mon service ? », « Liste les agents de mon service » |
| Super admin (99000000000000001) | « Les registres répondent-ils ? », « Le journal est-il intègre ? », « Quels services sont branchés ? » |

À essayer aussi : lui demander d'agir (« ouvre un dossier ») : il explique où cliquer, sans agir. Lui demander une vérification hors de son rôle (un citoyen qui veut vérifier un NIN) : il refuse.

## Ce que chacun voit

| Rôle | Voit | Ne voit pas |
|---|---|---|
| Citoyen | ses dossiers, ses pièces, qui a consulté ses données | les dossiers des autres |
| Agent | les dossiers de son service | ceux des autres services (tentative journalisée) |
| Admin | démarches (créer, modifier, désactiver) et agents de son service | aucun dossier |
| Super admin | services (créer, modifier, nouveau code, désactiver, supprimer), santé des registres, admins, super admins, journal global | aucun dossier |

## Tests automatiques

```
outils/tester.sh            # tout : couches serveur, interface, parcours dans le navigateur
E2E=0 outils/tester.sh      # sans le navigateur
```
