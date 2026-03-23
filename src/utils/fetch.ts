// Lightweight fetch wrapper used by runtime modules.
let _fetch: any = undefined;

try {
  // prefer global fetch if available
  if (typeof (globalThis as any).fetch === 'function') _fetch = (globalThis as any).fetch;
} catch (e) {}

if (!_fetch) {
  try { _fetch = require('undici').fetch; } catch (e) {}
}
if (!_fetch) {
  try { const nf = require('node-fetch'); _fetch = (nf && nf.default) || nf; } catch (e) {}
}

if (!_fetch) {
  // fallback stub that throws to make failures explicit
  _fetch = async function () { throw new Error('fetch not available in this environment'); };
}

export default _fetch;
// ROME-TAG: 0xF66B59

// small wrapper around available fetch implementations
// tries global fetch, then undici, otherwise falls back to node's http(s) for simple requests
import * as http from 'http';
import * as https from 'https';

export type FetchInit = { method?: string; headers?: Record<string,string>; body?: any };

async function simpleFetch(url: string, init: FetchInit = {}) {
  return new Promise<any>((resolve, reject) => {
    try {
      const u = new URL(url);
      const isHttps = u.protocol === 'https:';
      const lib: any = isHttps ? https : http;
      const opts: any = { method: init.method || 'GET', headers: init.headers || {}, hostname: u.hostname, port: u.port || (isHttps ? 443 : 80), path: u.pathname + (u.search || '') };
      const req = lib.request(opts, (res: any) => {
        const bufs: any[] = [];
        res.on('data', (d: any) => bufs.push(d));
        res.on('end', () => {
          const txt = Buffer.concat(bufs).toString('utf8');
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode, statusText: res.statusMessage, text: () => Promise.resolve(txt), json: () => Promise.resolve(JSON.parse(txt)), headers: res.headers });
        });
      });
      req.on('error', (e: any) => reject(e));
      if (init.body) req.write(typeof init.body === 'string' ? init.body : JSON.stringify(init.body));
      req.end();
    } catch (e) { reject(e); }
  });
}

export async function fetchWrapper(url: string, init?: FetchInit) {
  if (typeof (globalThis as any).fetch === 'function') return (globalThis as any).fetch(url, init as any);
  try {
    // try undici
     
    const undici = require('undici');
    if (undici && typeof undici.fetch === 'function') return undici.fetch(url, init as any);
  } catch (e) {
    // ignore
  }
  return simpleFetch(url, init || {});
}

export default fetchWrapper;
