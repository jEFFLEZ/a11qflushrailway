// small wrapper around available fetch implementations
// tries global fetch, then undici, otherwise falls back to node's http(s) for simple requests
import * as http from 'http';
import * as https from 'https';
async function simpleFetch(url, init = {}) {
    return new Promise((resolve, reject) => {
        try {
            const u = new URL(url);
            const isHttps = u.protocol === 'https:';
            const lib = isHttps ? https : http;
            const opts = { method: init.method || 'GET', headers: init.headers || {}, hostname: u.hostname, port: u.port || (isHttps ? 443 : 80), path: u.pathname + (u.search || '') };
            const req = lib.request(opts, (res) => {
                const bufs = [];
                res.on('data', (d) => bufs.push(d));
                res.on('end', () => {
                    const txt = Buffer.concat(bufs).toString('utf8');
                    resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode, statusText: res.statusMessage, text: () => Promise.resolve(txt), json: () => Promise.resolve(JSON.parse(txt)), headers: res.headers });
                });
            });
            req.on('error', (e) => reject(e));
            if (init.body)
                req.write(typeof init.body === 'string' ? init.body : JSON.stringify(init.body));
            req.end();
        }
        catch (e) {
            reject(e);
        }
    });
}
export async function fetchWrapper(url, init) {
    if (typeof globalThis.fetch === 'function')
        return globalThis.fetch(url, init);
    try {
        const undici = require('undici');
        if (undici && typeof undici.fetch === 'function')
            return undici.fetch(url, init);
    }
    catch (e) {
        // ignore
    }
    try {
        const nf = require('node-fetch');
        if (nf)
            return (nf && nf.default) || nf(url, init);
    }
    catch (e) { }
    return simpleFetch(url, init || {});
}
export default fetchWrapper;
