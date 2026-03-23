// In test/cortex mode provide a lightweight stub to avoid network noise
if (process.env.VITEST === 'true' || process.env.QFLUSH_MODE === 'cortex') {
  module.exports = async function fetchStub(url, opts = {}) {
    // respond positively for rome-index endpoints used in tests
    try {
      const u = typeof url === 'string' ? url : (url && url.url) || '';
      if (u.includes('/npz/rome-index')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], count: 0 }),
          text: async () => JSON.stringify({ items: [], count: 0 })
        };
      }

      // For local webhook endpoints (tests start a local HTTP server), forward
      // the request using node's http/https so the webhook receives the payload.
      if (typeof u === 'string' && (u.includes('127.0.0.1') || u.includes('localhost'))) {
        const parsed = new URL(u);
        const httpmod = parsed.protocol === 'https:' ? require('https') : require('http');
        const body = opts && opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined;
        const headers = Object.assign({ 'Content-Type': 'application/json' }, (opts && opts.headers) || {});
        if (body && !headers['Content-Length'] && !headers['content-length']) headers['Content-Length'] = Buffer.byteLength(body);

        return await new Promise((resolve) => {
          const req = httpmod.request({ hostname: parsed.hostname, port: parsed.port, path: (parsed.pathname || '/') + (parsed.search || ''), method: (opts && opts.method) || (body ? 'POST' : 'GET'), headers }, (res) => {
            let raw = '';
            res.on('data', (d) => raw += d.toString());
            res.on('end', () => {
              
              const out = { ok: res.statusCode && res.statusCode < 400, status: res.statusCode, text: async () => raw, json: async () => { try { return JSON.parse(raw); } catch (e) { return raw; } } };
              resolve(out);
            });
          });
          req.on('error', (err) => { console.warn('[fetchStub] request error', String(err)); resolve({ ok: false, status: 500, text: async () => '' }); });
          if (body) req.write(body);
          req.end();
        });
      }
    } catch (e) {}
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
} else {
  let _fetch = undefined;
  try { if (typeof globalThis.fetch === 'function') _fetch = globalThis.fetch; } catch (e) {}
  if (!_fetch) {
    try { _fetch = require('undici').fetch; } catch (e) {}
  }
  if (!_fetch) {
    try { const nf = require('node-fetch'); _fetch = (nf && nf.default) || nf; } catch (e) {}
  }
  if (!_fetch) {
    _fetch = async function () { throw new Error('fetch not available in this environment'); };
  }
  module.exports = _fetch;
}
