[![Activate CI](https://github.com/jEFFLEZ/qflush/actions/workflows/activate-ci.yml/badge.svg)](https://github.com/jEFFLEZ/qflush/actions/workflows/activate-ci.yml)

# qflush

`qflush` is the main Funesterie orchestrator.

It combines a CLI, a long-running daemon, ephemeral memory endpoints, NPZ helpers, service supervision hooks and integrations with modules such as Rome, Spyder, Bat, Freeland and Nezlephant.

## Current package line

- npm package: `@funeste38/qflush`
- current repo version: `4.0.10`
- daemon entry point: `src/daemon/qflushd.ts`

## What qflush is good at

- running a local or hosted orchestration daemon
- exposing admin and memory endpoints to A11 or other tools
- managing NPZ-oriented flows and Rome indexing helpers
- bridging telemetry, Redis-backed state and lightweight service supervision

## Install

```bash
npm install @funeste38/qflush
```

## Quick start

```bash
npm install
npm run build
npm start
```

Or with Railway-compatible scripts:

```bash
npm run railway:build
npm run railway:start
```

## Repository map

- `src/daemon/` -> HTTP daemon and operational endpoints
- `src/rome/` -> rule engine, indexing and action logic
- `src/commands/` -> CLI commands
- `src/utils/` -> Redis, secrets, fetch, HMAC, memory and path helpers
- `tests/` -> Vitest coverage for the critical runtime
- `runner-package/` -> lightweight runner flavor for CI or reduced environments

## Important runtime variables

- `QFLUSHD_PORT` or `PORT` -> daemon port
- `NEZ_ADMIN_TOKEN` -> protects admin and memory endpoints
- `REDIS_URL` / `QFLUSH_REDIS_URL` -> Redis backend for persistent and ephemeral state
- `QFLUSH_ENABLE_REDIS` / `QFLUSH_DISABLE_REDIS` -> Redis toggle
- `QFLUSH_DISABLE_COPILOT`, `QFLUSH_TELEMETRY`, `QFLUSH_ENABLE_COPILOT` -> telemetry controls
- `QFLUSH_COPILOT_TRANSPORTS` -> `file`, `webhook`, `sse`
- `QFLUSH_COPILOT_WEBHOOK_URL` -> outgoing webhook target
- `QFLUSH_LOG_FORMAT` -> `pretty`, `plain`, `json`

## Ephemeral memory

qflush exposes a TTL-based ephemeral memory layer that can run:

- on Redis when configured
- in local memory as fallback

Main endpoints:

- `/api/memory/ephemeral/status`
- `/api/memory/ephemeral/set`
- `/api/memory/ephemeral/get`
- `/api/memory/ephemeral/list`
- `/api/memory/ephemeral/delete`
- `/api/memory/ephemeral/clear`
- `/api/memory/ephemeral/touch`

Example:

```bash
curl -X POST http://127.0.0.1:43421/api/admin/run \
  -H "Authorization: Bearer changeme" \
  -H "Content-Type: application/json" \
  -d "{\"flow\":\"a11.memory.ephemeral.v1\",\"payload\":{\"op\":\"set\",\"scope\":\"user:jeff\",\"key\":\"last_topic\",\"value\":\"A11\",\"ttlSec\":1800}}"
```

## Railway notes

Recommended minimum for a stable hosted instance:

- `QFLUSH_DISABLE_COPILOT=0`
- `QFLUSH_ENABLE_COPILOT=1`
- `QFLUSH_TELEMETRY=1`
- `QFLUSH_COPILOT_TRANSPORTS=file,webhook`
- `QFLUSH_COPILOT_WEBHOOK_URL=...` only if you really want alerts
- `QFLUSH_DISABLE_REDIS=0` only when Redis is actually configured
- `NEZ_ADMIN_TOKEN=...`

On hosted ESM builds, qflush now loads `ioredis` through a compatible Node module bridge instead of silently falling back to memory because `require` was unavailable.

## Development

```bash
npm install
npm run build
npm test
npm run typecheck
```

## Good next improvements

- formal plugin API for external module registration
- clearer structured telemetry output per flow
- first-class dashboards for daemon state and memory usage
- more real-world fixtures around A11 and multi-service supervision

## Related packages

- `@funeste38/qflush-runner` for lightweight CI usage
- `@funeste38/rome` for workspace and process control
- `@funeste38/nezlephant` for OC8 payload transport
- `freeland` for value normalization
- `@funeste38/bat` for adaptive runtime behaviour
