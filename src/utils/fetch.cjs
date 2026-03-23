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
