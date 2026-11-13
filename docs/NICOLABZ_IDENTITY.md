# Nicolabz Identity — connexion Google et synchronisation de Batch & Co

Cette version reprend **le contrat d'API du dépôt `Diuxx/budget-nicolabz`**, mais avec un namespace de sauvegarde séparé pour Batch & Co. Le site reste **100 % statique** (Eleventy).

```text
Batch & Co (navigateur)
  ├─ localStorage : batch-and-co.v1 (sauvegarde automatique)
  ├─ Export/import JSON (manuel)
  └─ fetch credentials: include / redirect OAuth
                  │
                  ▼
Nicolabz Identity (Node.js, port 3000)
  ├─ GET /api/session
  ├─ GET /auth/google/start?app=batch-and-co&return_to=...
  ├─ GET /auth/drive/start?app=batch-and-co&return_to=...
  ├─ GET /api/sync/batch-and-co
  ├─ PUT /api/sync/batch-and-co {version,data}
  └─ POST /api/logout
                  │
                  ▼
Google Drive de l'utilisateur / appDataFolder
```

**Aucun Google SDK, Client ID, Client Secret, access token ou refresh token dans Batch & Co** : l'authentification Google, les jetons et la gestion de Drive sont sur l'API centrale.

## 1. Configuration de l'API (pas du site Eleventy)

Déclarer Batch & Co dans la variable `CLIENT_APPS_JSON` du service `nodjs-google-auth` en conservant les autres applications. Exemple :

```dotenv
CLIENT_APPS_JSON=[{"id":"budget","origins":["http://localhost:8081","https://budget.nicolabz.dev"]},{"id":"batch-and-co","origins":["http://localhost:8080","https://cooking.nicolabz.dev"]}]
```

Adapte les URL **à l'origine exacte du site réellement utilisé**. Chaque origine est affectée à un seul identifiant ; ne partage pas le port de Budget avec Batch & Co. Le port Eleventy est habituellement `8080`, mais vérifie celui indiqué dans ton terminal. Pour le site local, ouvre **`http://localhost:8080`** (pas `127.0.0.1`).

Pour tester le service en local : `PUBLIC_BASE_URL=http://localhost:3000`. En production : `PUBLIC_BASE_URL=https://auth.nicolabz.dev`, HTTPS et sous-domaines du même domaine pour le cookie SameSite. Le callback Google Cloud reste **celui de l'API** (`/auth/google/callback` et `/auth/drive/callback`) ; tu ne dois pas créer un client OAuth Google pour Batch & Co.

Si l'adresse de l'API change, modifier seulement `src/assets/js/identity/config.mjs` :

```js
export const IDENTITY_APP_ID = 'batch-and-co';
export const IDENTITY_BASE_URL = location.hostname === 'localhost'
  ? 'http://localhost:3000'
  : 'https://auth.nicolabz.dev';
```

## 2. Parcours utilisateur

1. Lancer l'API Nicolabz Identity, puis `npm run dev` dans Batch & Co.
2. Cliquer sur l'avatar en haut à droite → **Connexion Google**.
3. Après le retour OAuth, `GET /api/session` donne le nom, l'e-mail, la photo et l'état Drive. Le paramètre `auth=connected` **ne prouve pas** la connexion.
4. Ouvrir l'avatar → **Autoriser Google Drive**, puis revenir sur Batch & Co.
5. Ouvrir l'avatar → **Synchroniser le planning**. Si aucun fichier n'existe, confirmer l'envoi initial.
6. Sur un autre ordinateur, reconnecter le même compte : en cas de divergence entre navigateur et Drive, choisir explicitement **Récupérer Drive**, **Envoyer la version locale**, ou **Annuler**.

Une synchronisation ultérieure peut choisir automatiquement la direction **uniquement** quand l'ancre locale (version serveur + empreinte SHA-256) prouve qu'un seul côté a changé. Si les deux changent, une fenêtre de choix s'affiche. Un `409 SYNC_CONFLICT` stoppe l'opération et invite à relancer la comparaison, sans écraser le serveur.

La synchronisation est **manuelle comme dans Marge**, et ne s'exécute pas en arrière-plan. Tous les repas, collations, recettes, prix personnalisés et plannings restent sauvegardés dans `localStorage`. L'import/export JSON reste utilisable même si l'API est coupée.

## 3. Points d'attention

- Le stockage local est **partagé entre tous les comptes Google qui utilisent le même navigateur/origine**. Ne pas utiliser la connexion comme protection d'accès au contenu déjà présent dans `localStorage`.
- Le fichier Drive est dans `appDataFolder`, invisible depuis « Mon Drive » dans l'interface classique de Google.
- Le backend limite les JSON à ~1 Mio ; conserver une copie exportée de tes données.
- `CLIENT_APPS_JSON` autorise l'origine exacte. Les erreurs `INVALID_RETURN_URL` et `ORIGIN_FORBIDDEN` indiquent souvent un port ou domaine erroné.
- `DRIVE_NOT_CONNECTED` ou `DRIVE_RECONNECT_REQUIRED` : refaire l'autorisation Drive.
- `UNAUTHENTICATED` : vérifier le cookie HttpOnly et que localhost est utilisé pour l'API et Batch & Co.
- `NETWORK_ERROR` : vérifier l'URL de l'API, le certificat HTTPS, CORS et l'accessibilité réseau.
- Ce client n'accède pas directement aux API Google ; la validation OAuth réelle nécessite un service Nicolabz Identity opérationnel et un compte Google de test.

## 4. Vérifier

```bash
npm test
npm run check:data
npm run build
```

`tests/identity.test.mjs` vérifie URL de connexion, sessions, appels API, conflits, premiers envois et protections contre les modifications concurrentes, à l'aide de doubles en mémoire. `tests/identity-browser-smoke.py` est un test navigateur facultatif avec serveur HTTP et API simulée, à exécuter sur un poste ayant Chromium et Playwright Python. Il n'authentifie pas réellement un compte Google.
