# Registres simulés

Trois registres indépendants, construits pour la démonstration. Chacun a **ses propres données**, **son propre code secret**,
**son catalogue** et **ses règles d'accès** : c'est le registre, propriétaire des données, qui décide qui peut l'interroger.

| Registre | Dossier | Service dans le socle | Pièces | Réponses minimales | Règles d'accès |
|---|---|---|---|---|---|
| État civil (Mairie de Ouagadougou) | `etat_civil/` | `mairie-de-ouagadougou` | acte de naissance, acte de mariage | `majeur` | tous les services |
| Casier judiciaire (TGI de Ouagadougou) | `justice/` | `tribunal-de-ouagadougou` | extrait de casier (bulletin n° 3) | `casier_vierge` | bulletin complet : Direction des passeports et Ministère de la Fonction publique ; `casier_vierge` : tous |
| Nationalité (Ministère de la Justice) | `nationalite/` | `registre-de-la-nationalite` | certificat de nationalité, copie d'acte de naissance | — | tous les services |

Population : les 150 personnes fictives de `donnees/personnes.json` (NIN 99000000000000001 à …152, tirés du spécimen du ministère).
`generer.py` produit les données de chaque registre, avec des cas choisis pour la démonstration :

| Cas | Personnes (rang du NIN) |
|---|---|
| Toutes les pièces trouvées | la plupart, ex. 1, 3, 13 |
| Acte de naissance absent (« à fournir ») | multiples de 25 |
| Certificat de nationalité absent | multiples de 20 |
| Acte de naissance chez deux registres (« à choisir ») | multiples de 10 |
| Casier non vierge | multiples de 17 |
| Mineurs (pas de casier, « majeur : non ») | ex. 2, 24 |

## Contrat (identique pour tous)

Toutes les routes du contrat sont **signées dans les deux sens** (voir `commun/securite.py`) et reçoivent le contexte
`demandeur`, `dossier`, `finalite`. Spécifications : `../docs/openapi/registre-*.json`, ou `/docs` sur chaque registre.

| Route | Rôle |
|---|---|
| `GET /documents?iu=&types=` | pièces détenues, limitées aux types demandés et autorisés (403 sinon) |
| `GET /predicat?iu=&q=` | réponse oui/non sans transmettre la donnée source |
| `GET /lien?iu=&document=` | lien signé valable 5 minutes vers le PDF |
| `GET /catalogue` | pièces, réponses et règles d'accès |
| `GET /fichiers/{id}?iu=&exp=&sig=` | le PDF (document fictif « SPÉCIMEN »), seulement avec un lien valide |
| `GET /console?jeton=` | console du registre : sa propre trace des appels, ses règles, **simulation de panne** |

## Configuration

Variables d'environnement, préfixées par `ETAT_CIVIL_`, `JUSTICE_` ou `NATIONALITE_` :

| Variable | Rôle |
|---|---|
| `_SECRET` | **obligatoire** : le code secret généré par le super admin du socle pour ce service |
| `_SERVICE` | identifiant du service dans le socle (défaut : voir tableau) |
| `_URL_PUBLIQUE` | adresse publique du registre, pour les liens vers les fichiers |
| `_CONSOLE_JETON` | active la console de supervision |
| `_AUTORISATIONS` | remplace les règles d'accès, en JSON |

## Lancer

```bash
cd registres
python3 generer.py                                   # (re)générer les données
uvicorn serveur:app --port 8005 --proxy-headers       # les trois registres sous /registres/…
uvicorn etat_civil.app:app --port 8011                # ou un registre seul
```

Brancher ensuite chaque registre depuis `/frontend/connect` du socle : identifiant du service, code secret, puis
l'adresse de la route documents (les autres routes sont proposées automatiquement).

## Tests

```bash
../.venv/bin/python -m pytest tests -q
```
