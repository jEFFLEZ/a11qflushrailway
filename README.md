[![Activate CI](https://github.com/jEFFLEZ/qflush/actions/workflows/activate-ci.yml/badge.svg)](https://github.com/jEFFLEZ/qflush/actions/workflows/activate-ci.yml)

# qflush — Aperçu et guide développeur

**Version 3.1.5**

Résumé rapide
- qflush est l'orchestrateur (CLI + daemon) principal du projet Funesterie. Le coeur se trouve dans `src/` et la sortie build dans `dist/`.

> Note: The `dist/` build artifacts should not be committed to the repository. If you have a local `dist/` directory, prefer adding it to `.gitignore` and removing it from the index (e.g. `git rm -r --cached dist/`). This repository already lists `dist/` in `.gitignore`.

Architecture (big picture)
- Entrées principales:
  - `src/daemon/qflushd.ts` : serveur HTTP (endpoints admin & NPZ).
  - `src/rome/*` : moteur d'indexation, linker et logique ( règles, exécution d'actions ).
  - `src/commands/*` : implémentation des commandes CLI exposées dans `package.json`.
  - `src/utils/*` : helpers (redis, secrets, fetch, hmac, etc.).

- Flux de données : le daemon expose des endpoints `/npz/*` pour checksum, rome-index et liens ; le moteur Rome parcourt et évalue des règles qui déclenchent des actions (ex : `daemon.reload`, `start-service`).

Convention de build / piège courant
- TypeScript : `tsconfig.json` doit avoir `rootDir: "src"` et `include: ["src/**/*"]` — cela permet à `tsc` de générer `dist/daemon/qflushd.js` (les scripts CI s'attendent à `dist/daemon/*`).

Commandes utiles
- Installer dépendances : `npm ci --no-audit --no-fund`
- Builder : `npm run build` (exécute `tsc -p .`).
- Lancer le daemon compilé : `node dist/daemon/qflushd.js` ou `npm start`.
- Tests : `npm test` (Vitest). En CI/Vitest le bootstrap démarre automatiquement la version compilée du daemon via `vitest.setup.js`.
- Quick API examples are available in `docs/quick-start.md` and below.

Comportements runtime & variables d'environnement importants
- `QFLUSHD_PORT` : port du daemon (défaut 4500 ou 43421 selon scripts). Tests/CI attendent parfois `4500`.
- `QFLUSH_ENABLE_REDIS` : contrôle l'utilisation de Redis (0 = in-memory fallback).
- `QFLUSH_DISABLE_COPILOT` / `QFLUSH_TELEMETRY` : désactiver la passerelle copilot/telemetry en runtime.
- `QFLUSH_ENABLE_COPILOT` / `QFLUSH_COPILOT_ENABLED` : active la telemetrie Copilot sans fichier local.
- `QFLUSH_COPILOT_TRANSPORTS` : transports actifs (`file`, `webhook`, `sse`) separes par virgules.
- `QFLUSH_COPILOT_WEBHOOK_URL` : webhook de sortie (Slack ou autre receiver JSON).
- `QFLUSH_COPILOT_FILE_PATH` : chemin du journal telemetrie.
- `QFLUSH_LOG_FORMAT` : format des logs (`pretty`, `plain`, `json`) pour Railway, desktop ou CI.
- `QFLUSH_LOG_NO_COLOR` : désactive les couleurs ANSI même en mode `pretty`.
- `QFLUSH_LOG_TIMESTAMPS` : active ou coupe les timestamps dans les logs texte.
- `VITEST` : si défini, `vitest.setup.js` tente de require et démarrer `dist/daemon/qflushd`.

Conseil Railway
- ne pas “tout activer” a l'aveugle. Le minimum utile pour un Qflush riche mais stable:
  - `QFLUSH_DISABLE_COPILOT=0`
  - `QFLUSH_ENABLE_COPILOT=1`
  - `QFLUSH_TELEMETRY=1`
  - `QFLUSH_COPILOT_TRANSPORTS=file,webhook`
  - `QFLUSH_COPILOT_WEBHOOK_URL=...` si tu veux des notifications
  - `QFLUSH_DISABLE_REDIS=0` seulement si `REDIS_URL` est vraiment configure

Profils d'environnement
- qflush peut maintenant charger des profils depuis `.qflush/env.profiles.json`, `.qflush/env.profiles.yaml` ou `.qflush/env.profiles.yml`.
- Commandes utiles :
  - `qflush env init`
  - `qflush env list`
  - `qflush env show dev`
  - `qflush env check railway`
  - `qflush env generate railway --out .env.generated`
- Format minimal :

```json
{
  "profiles": {
    "dev": {
      "files": [".env", ".env.local"],
      "vars": {
        "QFLUSHD_PORT": "43421",
        "QFLUSH_LOG_FORMAT": "pretty"
      },
      "required": ["QFLUSHD_PORT"]
    },
    "railway": {
      "extends": "dev",
      "vars": {
        "QFLUSH_LOG_FORMAT": "json"
      }
    }
  }
}
```

SPYDER admin port
- `QFLUSH_SPYDER_ADMIN_PORT` : override du port admin que SPYDER expose (valeur entière). Utile en CI ou pour éviter des conflits locaux.
- Fichier de configuration projet : `.qflush/spyder.config.json` peut contenir la clé `adminPort`. En alternative historique, `.qflush/logic-config.json` peut contenir `spyderAdminPort`.
- Comportement par défaut : `4001` si aucune configuration fournie.
- Note : `qflush start` persiste automatiquement `adminPort` dans `.qflush/spyder.config.json` si la clé manque, pour que d'autres composants puissent lire la valeur.

Points d'intégration et tests
- CI (workflow `CI`) : installe deps, compile (`npx tsc`) et démarre le daemon, puis exécute les tests. Les tests d'intégration vérifient les endpoints `/npz/checksum/*` et `/npz/rome-index`.
- Si vous rencontrez des erreurs de type `dist/daemon/qflushd.js missing` : vérifier `tsconfig.json` (rootDir/include) puis `npm run build`.

Où regarder en priorité
- `src/daemon/qflushd.ts` — comportement du serveur et endpoints.
- `src/rome/` — logique d'indexation et exécution d'actions.
- `src/commands/` — exemples d'utilisation du moteur via la CLI.
- `package.json` — scripts exposés (build, test, start, daemon:spawn, etc.).

Proposition pour la suite
- J'ai appliqué les changements suivants en local:
  1) Vérifié que `dist/` est ignoré via `.gitignore` et supprimé les artefacts compilés suivis (`dist/daemon/qflushd.js`) pour éviter d'avoir des artefacts de build dans le commit.
  2) Ajouté des exemples d'API rapides dans `docs/quick-start.md`.

Si tu veux que je :
  - retire complètement tous les fichiers `dist/` du dépôt ou crée une PR automatique, dis‑le et je m'en occupe.
  - ajoute d'autres extraits d'exemples d'API pour `/npz/*` ou des scripts d'installation, je peux les ajouter.

---
Pour feedback ou détails supplémentaires, dites-moi quelle partie vous voulez développer en priorité.

Exemples d'API (endpoints NPZ)

- Store checksum

```bash
curl -X POST "http://localhost:4500/npz/checksum/store" \
   -H "Content-Type: application/json" \
   -d '{"id":"t1","checksum":"abc","ttlMs":60000}'
```

- List checksums

```bash
curl "http://localhost:4500/npz/checksum/list"
```

- Verify checksum (mismatch returns non-200)

```bash
curl -X POST "http://localhost:4500/npz/checksum/verify" \
   -H "Content-Type: application/json" \
   -d '{"id":"t1","checksum":"abc"}'
```

- Clear checksums

```bash
curl -X DELETE "http://localhost:4500/npz/checksum/clear"
```

- Fetch Rome index

```bash
curl "http://localhost:4500/npz/rome-index"
```

Notes:
- En local, la variable `QFLUSHD_PORT` peut être utilisée pour changer le port (ex: `QFLUSHD_PORT=43421`).
- Les tests d'intégration supposent que le daemon compilé expose ces endpoints (via `dist/daemon/qflushd.js`).

## Optional integration: A-11 (local AI service)

FR
-----
qflush peut piloter un serveur IA local nommé "A-11" (ex: backend Node + Ollama). Cette intégration est entièrement optionnelle : si A-11 n'est pas installé ou activé, qflush l'ignore et continue d'orchestrer les autres services.

Exemple de configuration (dans `.qflush/a11.config.json`):

```json
{
  "enabled": true,
  "path": "D:/projects/a11",
  "startCommand": "pwsh -File start-a11-system.ps1",
  "healthUrl": "http://127.0.0.1:3000/health",
  "pidFile": ".qflush/a11.pid"
}
```

Commandes utiles:
- `qflush start a11` — démarre A-11 si `enabled` et si `startCommand` est défini.
- `qflush stop a11` — arrête A-11 si un `pidFile` a été créé lors du démarrage.
- `qflush a11:status` — vérifie le endpoint `healthUrl` ou la présence du processus.

Comportement:
- Si `enabled` = false ou le fichier de config manque, qflush n'essaie pas d'installer ni de lancer A-11.
- En cas d'échec de démarrage, qflush loggue une erreur et continue les autres modules.

EN
-----
qflush can orchestrate an optional local AI service named "A-11" (for example a Node + Ollama backend). This integration is optional: if A-11 is not installed or enabled, qflush will ignore it and continue orchestrating other services.

Example configuration (put into `.qflush/a11.config.json`):

```json
{
  "enabled": true,
  "path": "D:/projects/a11",
  "startCommand": "pwsh -File start-a11-system.ps1",
  "healthUrl": "http://127.0.0.1:3000/health",
  "pidFile": ".qflush/a11.pid"
}
```

Useful commands:
- `qflush start a11` — starts A-11 when `enabled` and `startCommand` provided.
- `qflush stop a11` — stops A-11 if a `pidFile` was recorded on start.
- `qflush a11:status` — checks `healthUrl` or process presence.

Behavior notes:
- If `enabled` is false or config file is absent, qflush will not try to install or start A-11.
- On start failure qflush logs a clear message and continues with other services.

## CI / Ports guidance
To avoid port collisions with SPYDER when running CI on shared/self-hosted runners, set the following environment variables in your workflow or `.env`:

```
# Qflush daemon port (avoid conflicts with Spyder admin port)
QFLUSHD_PORT=43421
# SPYDER admin port (override to avoid conflicts)
QFLUSH_SPYDER_ADMIN_PORT=4022
```

Use these in GitHub Actions jobs:

```yaml
env:
  QFLUSHD_PORT: '43421'
  QFLUSH_SPYDER_ADMIN_PORT: '4022'
  QFLUSH_DISABLE_WEBHOOK: '1'
  QFLUSH_TEST_TOKEN: '${{ secrets.QFLUSH_TEST_TOKEN }}'
```

This mirrors `docs/quick-start.md` recommendations and the `.env.example` in the repo.

## Module system strategy (ESM + CJS fallbacks)

This repository primarily uses ECMAScript modules (ESM) and Node's `NodeNext` resolution. To maintain compatibility with older CommonJS-only packages and optional runtime fallbacks, the project follows a dual-mode approach:

- Source files are authored as ESM (`import`/`export`) and compiled to `dist/` with `.js` extensions in imports.
- Where necessary we keep selective `require()` fallbacks or small `*.js` wrappers (for example `src/services.js`) to support runtime resolution of CJS modules or optional packages.
- For ESM-only third-party packages (for example `node-fetch`), prefer using dynamic `import()` with fallbacks to `undici` or `globalThis.fetch`.

Why this approach?
- Ensures the CLI and daemon run in modern Node.js (ESM) while remaining resilient to modules that are still published as CommonJS.
- Keeps tests and CI stable because some runtime resolution paths intentionally use `require()` as a safe fallback.

Contribution guidance
- Avoid adding static default imports of known ESM-only packages (e.g. `import fetch from 'node-fetch'`). Use the project's pattern: dynamic `import('node-fetch')` with fallback to `undici` or `globalThis.fetch`.
- Run `npm run check-esm-imports` before opening PRs to detect static imports of known ESM-only packages.
- If you need to remove CJS fallbacks, open a PR and test thoroughly in CI — this is a breaking, repo-wide change.
# a11qflushrailway
