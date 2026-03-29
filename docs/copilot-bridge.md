# Copilot Bridge — Telemetry & Security

This document describes the Copilot Bridge transport options, HMAC signing, and secure setup.

## Config
Place `.qflush/copilot.json` with the following minimal keys:

```json
{
  "enabled": true,
  "transports": ["file","webhook"],
  "webhookUrl": "https://copilot.example/api/telemetry",
  "hmacSecretEnv": "COPILOT_HMAC",
  "filePath": ".qflush/telemetry.json"
}
```

## HMAC signing
- Set a secret value in repository/host environment variable referenced by `hmacSecretEnv` (e.g. `COPILOT_HMAC`).
- The bridge will sign webhook payloads with `X-Copilot-Signature: sha256=<hex>` header.

Example verification (Node):

```js
const crypto = require('crypto');
function verify(payload, headerSig, secret) {
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return headerSig === `sha256=${expected}`;
}
```

## Endpoint auth
- Protect `/copilot/*` and `/npz/engine/*` endpoints by setting `NEZ_ADMIN_TOKEN` env var on the daemon.
- Include header `x-qflush-token: <TOKEN>` when calling these endpoints (CLI or extension).

## Telemetry retention
- Telemetry is written to `.qflush/telemetry.json` and persisted into `.qflush/qflush.db` if sqlite is available.
- Rotate telemetry files daily in your ops scripts or configure archival.

## Privacy
- Telemetry redacts environment variables and long file contents >4KB.
- Only enable telemetry for trusted networks or when webhook targets are under your control.
