import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, stopServer } from '../daemon/qflushd.js';
import fs from 'fs';
import * as path from 'path';

const URL = 'http://127.0.0.1:4500';

async function resolveFetch() {
  if (typeof (globalThis as any).fetch === 'function') return (globalThis as any).fetch;
  try {
    const m = await import('node-fetch');
    return (m && (m as any).default) || m;
  } catch (e) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const undici = require('undici');
      if (undici && typeof undici.fetch === 'function') return undici.fetch;
    } catch (_) {}
  }
  throw new Error('No fetch available for tests');
}

let fetch: any;

beforeAll(async () => {
  process.env.NEZ_ADMIN_TOKEN = 'test-token';
  process.env.QFLUSH_SAFE_CI = '1';
  fetch = await resolveFetch();
  // ensure server started and ready
  await startServer(4500);
});

afterAll(async () => {
  try { await stopServer(); } catch (e) {}
});

describe('NPZ BAT control endpoints (embedded)', () => {
  it('POST /npz/sleep requires token and sets safe mode', async () => {
    // without token header
    const r1 = await fetch(`${URL}/npz/sleep`, { method: 'POST' });
    expect(r1.status).toBe(401);

    // with token
    const r2 = await fetch(`${URL}/npz/sleep`, { method: 'POST', headers: { 'x-qflush-token': 'test-token' } });
    expect(r2.status).toBe(200);
    const body = await r2.json() as any;
    expect(body.success).toBe(true);
    expect(body.mode).toBe('sleep');

    // verify safe-modes.json exists
    const p = path.join(process.cwd(), '.qflush', 'safe-modes.json');
    expect(fs.existsSync(p)).toBe(true);
  });

  it('POST /npz/wake requires token and clears safe mode', async () => {
    const r = await fetch(`${URL}/npz/wake`, { method: 'POST', headers: { 'x-qflush-token': 'test-token' } });
    expect(r.status).toBe(200);
    const body = await r.json() as any;
    expect(body.success).toBe(true);
    expect(body.mode).toBe('normal');
  });

  it('POST /npz/joker-wipe requires token and performs wipe (test mode skip exit)', async () => {
    const r = await fetch(`${URL}/npz/joker-wipe`, { method: 'POST', headers: { 'x-qflush-token': 'test-token' } });
    expect(r.status).toBe(200);
    const body = await r.json() as any;
    expect(body.success).toBe(true);
    expect(body.mode).toBe('joker');
  });
});
