# Dites-le-nous une fois

**Socle d'interopérabilité entre administrations** (Burkina Faso) : les pièces circulent entre les administrations, pas l'usager
entre les guichets, dans le respect de ses droits sur ses données.

- Au guichet, l'usager ne donne que son **code unique** : les pièces (acte de naissance, certificat de nationalité, casier…) sont
  demandées directement aux administrations qui les détiennent.
- **Seul l'utile circule** : « majeur : oui » plutôt que la date de naissance, « casier vierge : oui » plutôt que le casier.
- **Tout est tracé** : l'usager voit dans son espace qui a consulté ses données, quand et pourquoi.
- **Rien à installer chez les administrations** : chacune se branche avec son propre système, et garde ses données.

Licence libre **EUPL 1.2**.

---

## Essayer en 5 minutes (démonstration locale)

Prérequis : **Python 3.12** et **Node.js 18+**.

```bash
python3 outils/demo_locale.py
```

Une seule commande : au premier lancement, elle installe ce qui manque (environnement Python, interface), puis démarre tout.

Ouvrir l'adresse affichée (http://127.0.0.1:8193/frontend/). La démonstration lance des **registres simulés** (état civil,
casier judiciaire, nationalité, identité) peuplés de citoyens fictifs, les branche au socle, et crée les comptes ci-dessous.
Rien n'est écrit sur le disque : chaque lancement repart des mêmes données.

**Se connecter** : saisir un code unique — ou cliquer sur **« 🧪 Données de test »** sous le champ et choisir un profil — puis le code à 6 chiffres (en démonstration, il s'affiche à l'écran), puis choisir son espace.

| Compte | Code unique |
|---|---|
| Super admin | 99000000000000001 |
| Admin de service (passeports / ONI / Fonction publique) | 99000000000000021 / 022 / 023 |
| Agent (passeports / ONI / Fonction publique) | 99000000000000033 / 034 / 035 |
| Citoyen : toutes les pièces arrivent seules | 99000000000000036 |
| Citoyen : acte détenu par deux registres (il choisit) | 99000000000000010 |
| Citoyen : aucun acte de naissance (il le dépose) | 99000000000000025 |

**Un parcours complet** : connecté comme agent 99000000000000033 → « Nouveau dossier » → code unique 99000000000000036 →
« Vérifier » → démarche « Demande de passeport » → « Ouvrir le dossier » : les pièces arrivent. Puis connecté comme citoyen
99000000000000036 → « Qui a consulté mes données ». Pour une **panne** : console du registre (adresse affichée au lancement)
→ « Simuler une panne » ; la pièce passe « indisponible », n'est jamais demandée au citoyen, et la recherche reprend seule.

## Qui fait quoi

| Rôle | Ce qu'il fait |
|---|---|
| Super admin | crée et gère les services (administrations), leur remet un code de branchement, nomme les admins, suit la santé des registres |
| Admin de service | crée les démarches de son service (finalité, pièces), nomme ses agents |
| Agent | ouvre les dossiers au guichet avec le code unique de l'usager, consulte les pièces en lecture seule |
| Citoyen | suit ses demandes, voit qui a consulté ses données |
| Administration détentrice | se branche sur `/frontend/connect` avec son code, passe le banc de conformité, décide qui peut lui demander quoi |

## Installer pour de vrai

1. Copier `backend/.env.exemple` en `backend/.env` et le remplir (base de données : SQLite, PostgreSQL / Supabase ou Firebase ;
   assistant facultatif). Ce fichier n'est jamais publié.
2. Premier démarrage : `cd backend && python3 ../outils/installer_super_admin.py <code unique> --service-identite "<nom du service d'identité>"`.
3. Lancer : `cd backend && ../.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8004`, derrière un serveur web en HTTPS.
4. Brancher les administrations depuis l'espace super admin et la page `/frontend/connect`.

Tout est détaillé dans le **[guide de réutilisation](livrables/guide-de-reutilisation.md)**.

## Organisation du code (un dossier par couche)

| Dossier | Couche | Rôle |
|---|---|---|
| `registres/` | Registres | registres simulés indépendants : état civil, casier judiciaire, nationalité, identité |
| `passerelle/` | Passerelle d'échange | branchement, échanges signés dans les deux sens, adaptateur, banc de conformité, pannes (`/connect`) |
| `consentement/` | Consentement et minimisation | accord de chaque dossier, contrôle avant tout échange (`/consentement`) |
| `journal/` | Journal de traçabilité | journal chaîné, scellé, en ajout seul, tenu par le serveur (`/journal`) |
| `espace-usager/` | Espace usager | interface React : citoyen, guichet agent, admin, super admin, page de branchement |
| `assistant/` | Assistant (facultatif) | questions et vérifications en langage courant, avec les droits de la personne connectée (`/assistant`) |
| `backend/` | Socle | assemblage du serveur : connexion, contrôle d'accès par rôle, stockage |
| `outils/` | | démonstration, tests, installation, export OpenAPI, transfert de base, conversion PDF |
| `livrables/` | | rapport, guides, règles du socle, spécifications OpenAPI, résultats des tests |

L'API est documentée sur `/docs` ; les spécifications OpenAPI de chaque couche sont dans `livrables/specifications-openapi/`.

## Tester

```bash
.venv/bin/pip install pytest
outils/tester.sh          # tests de chaque couche (pytest), de l'interface (vitest), et parcours complet dans un navigateur
E2E=0 outils/tester.sh    # sans le navigateur
```

Le parcours dans le navigateur demande en plus **Playwright** (`pip install playwright`) et **Google Chrome**.

## Documentation

| Document | Contenu |
|---|---|
| [Rapport](livrables/rapport.md) | architecture, démarches, tests d'interopérabilité, protection des données |
| [Règles du socle](livrables/regles-du-socle.md) | règles de consentement, de minimisation et de traçabilité, durées |
| [Guide de test](livrables/guide-de-test.md) | tout essayer, rôle par rôle |
| [Guide de réutilisation](livrables/guide-de-reutilisation.md) | installer le socle dans une autre administration |

## Licence

Bien commun publié sous **EUPL 1.2** ([`LICENCE.md`](LICENCE.md), texte officiel dans [`LICENSE`](LICENSE)) : chacun peut
l'utiliser, l'adapter et le redistribuer ; une version modifiée et distribuée reste libre.
