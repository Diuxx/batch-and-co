# Batch & Co — Eleventy

Planification de repas sur une seule page, avec stockage local et connexion Google facultative via Nicolabz Identity, avec calories, coût théorique, ingrédients, recettes personnalisables, collations, liste de courses et import/export JSON.

## Installation

Prérequis : Node.js 20+ et npm.

```bash
npm install
npm run dev
```

Accéder à l'URL affichée par Eleventy (généralement `http://localhost:8080`).

```bash
npm run build           # génère _site/
npm test                # tests métier Node.js
npm run check:data      # contrôle les ingrédients, plats et prix
```

Déployer simplement le contenu généré de `_site/` sur Nginx, Caddy, GitHub Pages ou un autre hébergeur statique. Pour les tests locaux sans Eleventy, une maquette statique est incluse dans `preview/` : `python -m http.server 8000 -d preview` puis ouvrir `http://localhost:8000`. La maquette est construite à partir des mêmes sources, mais ne remplace pas le build Eleventy.

## Sources de données

| Fichier | Rôle |
| --- | --- |
| `data/ingredients.json` | Noms, kcal/100 g, catégories et identifiants stables |
| `data/recipes.json` | Compositions par portion ; quantités en grammes |
| `data/prices.json` | **Prix modifiables avant build**, statut et provenance |
| `src/_data/catalog.js` | Validation et fusion de l'ensemble au moment du build |
| `src/_includes/` | Layout et composants Nunjucks |
| `src/assets/js/domain.mjs` | Calculs métier purs (recettes et courses) |
| `src/assets/js/app.js` | Interactions, sauvegarde locale et éditeurs |

### Modifier un prix

Ouvrir `data/prices.json`, chercher `items.riz` (par exemple), puis changer `eurPerKg` :

```json
"riz": {
  "eurPerKg": 1.7,
  "status": "verified",
  "retailer": "Carrefour Classic’",
  "pack": "1 kg",
  "packagePrice": 1.7,
  "url": "https://www.carrefour.fr/p/riz-long-incollable-10-min-carrefour-classic-3560070822294",
  "note": ""
}
```

Si le prix n'est pas vérifié : mettre `status: "estimated"` et adapter `retailer`, `pack`, `url` et `note`. La date `checkedAt` du fichier doit être mise à jour lors des nouveaux relevés. Ensuite `npm run build`. Les modifications du JSON sont également observées par `npm run dev`.

**Attention :** Les tarifs vérifiés sont des prix d'affichage en ligne consultés le **25 octobre 2026**, sur le site Carrefour ; ils varient suivant le magasin, les conditions de vente et la date. Les autres valeurs sont marquées comme **estimations éditoriales** (non vérifiées). Aucune récupération automatique des prix ni promesse de temps réel. Les kcal sont des valeurs nutritionnelles indicatives, pas un relevé de chaque marque. Le prix utilisé par l'application est **€/kg de matière consommée**, même pour lait et huile (conversion indicative de volume en masse) et pour les œufs (environ 50 g comestibles par œuf). Ceci rend le calcul par grammage possible, mais différent du prix de packs entiers payé en caisse.

## Fonctionnement côté navigateur

- Sauvegarde : `localStorage`, clé `batch-and-co.v1` conservée pour récupérer automatiquement la version HTML V2.
- Export : JSON complet contenant tes repas sur toutes les semaines, nouveaux plats, ingrédients, portions, budget, produits cochés et prix personnalisés.
- Import : JSON V1/V2/V3 validé avant remplacement, limite de 3 Mo. L'import remplace tes données après confirmation.
- À chaque ouverture, les nouvelles matières premières et recettes du build sont fusionnées au catalogue local ; les nouveaux prix du build s'appliquent aux ingrédients de base non personnalisés. Les prix explicitement modifiés dans l'interface sont prioritaires. Pour les anciennes sauvegardes V1/V2, les prix existants sont préservés comme personnalisations, afin de ne pas perdre des changements éventuels. Utiliser « Réinitialiser les prix personnalisés » dans le catalogue pour adopter ceux du build.
- Les plats que tu supprimes parmi les recettes de base ne sont pas recréés automatiquement à l'ouverture (à partir de V3).
- Le stockage local dépend du **navigateur et de l'origine** (URL) du site. Utiliser l'export/import JSON pour passer d'un poste à l'autre, et conserver une copie de sauvegarde. Un navigateur en mode privé ou un nettoyage du site peut effacer les données.
- Au premier lancement, la semaine est préremplie avec des **exemples modifiables**.

## Limites connues

- Liste de courses calculée par grammage consommé, sans arrondi aux conditionnements réellement vendus.
- Les kcal affichées correspondent aux quantités de matières premières de chaque recette, pas à des valeurs de laboratoire après cuisson ; perte de cuisson et déchets non gérés.
- Synchronisation multi-appareils **manuelle** via Nicolabz Identity et Google Drive ; l’import/export JSON reste disponible sans compte.
- Les préparations peuvent être répétées sur plusieurs jours, mais il n'y a pas encore de plan de sessions de cuisine, de gestion de conservation ou de chaîne du froid.
- Les ingrédients personnalisés ajoutés dans l'interface sont propres à la session locale ; pour les rendre préchargés sur tous les appareils, les reporter dans les fichiers JSON avant build.

## Vérification

`npm test` couvre les calculs, l'agrégation des quantités de courses et la cohérence des informations de prix. Pour tester l'application dans le navigateur, se référer à `tests/browser-smoke.py` (Chromium et Playwright Python requis pour ce script de développement). Le rendu Eleventy dépend de `npm install` qui nécessite un accès au registre npm.


## Connexion Google et Drive (v1.2)

L'intégration reprend le fonctionnement de **Marge (budget-nicolabz)** : avatar de profil en haut à droite, session centralisée et consentement Drive séparé. Elle remplace l'approche de la v1.1 où le navigateur appelait directement les APIs Google.

- `GET /api/session` : état de connexion et photo de l'utilisateur.
- `/auth/google/start?app=batch-and-co` : connexion gérée par Nicolabz Identity.
- `/auth/drive/start?app=batch-and-co` : consentement séparé.
- `GET/PUT /api/sync/batch-and-co` : sauvegarde JSON, avec contrôle de version et conflits.
- Stockage local inchangé : `batch-and-co.v1`, export et import JSON toujours actifs.

**À faire sur l'API** : ajouter une application `batch-and-co` et les origines exactes à `CLIENT_APPS_JSON`. Aucun identifiant OAuth Google n'est à mettre dans ce dépôt.

Le guide détaillé, la configuration locale et la procédure de migration se trouvent dans [docs/NICOLABZ_IDENTITY.md](docs/NICOLABZ_IDENTITY.md).
