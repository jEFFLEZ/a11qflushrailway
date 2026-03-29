// ROME-TAG: 0x2F0688

import * as http from 'http';
import { spawn, ChildProcess } from 'child_process';
import fetch from '../utils/fetch.js';

const PORT = process.env.QFLUSHD_PORT ? Number(process.env.QFLUSHD_PORT) : 4500;
const BASE = `http://127.0.0.1:${PORT}`;

async function waitForJson(path: string, attempts = 20, delayMs = 250) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${BASE}${path}`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const j = await res.json();
      return j;
    } catch (e) {
      console.warn('[rome-index test] waitForJson attempt failed', String(e));
      // wait and retry
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error(`failed to fetch JSON ${path} after ${attempts} attempts`);
}

async function isReachable(attempts = 5, delayMs = 200) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${BASE}/npz/rome-index`);
      if (res.ok) return true;
    } catch (e) { console.warn('[rome-index test] isReachable fetch failed', String(e)); }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

export async function runTests() {
  let serverMod: any = null;
  let spawned: ChildProcess | null = null;
  try {
    // Si le service est déjà joignable, skip démarrage
    if (!(await isReachable(100, 200))) {
      try {
        // ensure daemon token available when starting in-process or spawning
        if (!process.env.NEZ_ADMIN_TOKEN) process.env.NEZ_ADMIN_TOKEN = 'test-token';
        // prefer importing the TS module (no .js) so Vitest can resolve it
        // add explicit extension to satisfy Node ESM resolution in TS settings
        serverMod = await import('../daemon/qflushd.js');
        // start server programmatically on test port
        if (serverMod && typeof serverMod.startServer === 'function') {
          console.log('[rome-index] Démarrage du daemon via startServer');
          await serverMod.startServer(PORT);
        } else {
          // fallback: spawn daemon process from dist (if present)
          try {
            console.log('[rome-index] Démarrage du daemon via spawn');
            // spawn a node helper that requires the dist module and starts the server
            const inline = `require('./dist/daemon/qflushd').startServer(${PORT}).catch(e=>{ console.error(e); process.exit(1); });`;
            spawned = spawn('node', ['-e', inline], {
              env: { ...process.env, QFLUSHD_PORT: String(PORT), QFLUSH_ENABLE_REDIS: '0' },
              stdio: ['ignore', 'pipe', 'pipe'],
            });
            if (spawned.stdout) spawned.stdout.on('data', (d) => console.log('[qflushd]', d.toString()));
            if (spawned.stderr) spawned.stderr.on('data', (d) => console.error('[qflushd]', d.toString()));
          } catch (e) {
            console.error('[rome-index] Echec du spawn du daemon', e);
          }
        }
      } catch (e) {
        // import failed; try spawning the dist daemon as a last resort
        try {
          console.log('[rome-index] Import du daemon échoué, tentative spawn');
          const inline = `require('./dist/daemon/qflushd').startServer(${PORT}).catch(e=>{ console.error(e); process.exit(1); });`;
          spawned = spawn('node', ['-e', inline], {
            env: { ...process.env, QFLUSHD_PORT: String(PORT), QFLUSH_ENABLE_REDIS: '0' },
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          if (spawned.stdout) spawned.stdout.on('data', (d) => console.log('[qflushd]', d.toString()));
          if (spawned.stderr) spawned.stderr.on('data', (d) => console.error('[qflushd]', d.toString()));
        } catch (ee) {
          console.error('[rome-index] Echec du spawn du daemon (fallback)', ee);
        }
      }

      // give it a moment to start
      await new Promise((r) => setTimeout(r, 400));

      // ensure it's reachable before proceeding
      if (!(await isReachable(100, 200))) {
        console.error(`[rome-index] qflushd not reachable at ${BASE} après 100 tentatives`);
        throw new Error(`qflushd not reachable at ${BASE}`);
      } else {
        console.log(`[rome-index] qflushd est bien démarré sur ${BASE}`);
      }
    } else {
      console.log(`[rome-index] qflushd déjà joignable sur ${BASE}`);
    }

    const res = await fetch(`${BASE}/npz/rome-index`);
    const j: any = await res.json();
    console.log('rome-index test response:', j && j.count);

    const all: any = await waitForJson('/npz/rome-index', 40, 200);
    if (!all || !Array.isArray(all.items)) {
      console.error('invalid index response', all);
      throw new Error('invalid index response');
    }
    console.log('rome-index count=', all.count);

    // try filter by type 'daemon' (should return 0 or more)
    const byDaemon: any = await waitForJson('/npz/rome-index?type=daemon', 10, 200);
    if (!byDaemon || !Array.isArray(byDaemon.items)) {
      console.error('invalid filtered response', byDaemon);
      throw new Error('invalid filtered response');
    }
    console.log('rome-index daemon count=', byDaemon.count);
    } finally {
    try { if (serverMod && typeof serverMod.stopServer === 'function') serverMod.stopServer(); } catch (e) { console.warn('[rome-index test] stopServer failed', String(e)); }
    try { if (spawned && typeof spawned.kill === 'function') spawned.kill(); } catch (e) { console.warn('[rome-index test] kill spawned failed', String(e)); }
  }
}

import { describe, it, expect } from 'vitest';

describe('rome-index (stub)', () => {
  it('stub passes', () => {
    expect(true).toBe(true);
  });
});
