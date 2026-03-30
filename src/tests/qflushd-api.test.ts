import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import net from 'node:net';
import * as http from 'node:http';
import fetch from '../utils/fetch.js';
import { startServer, stopServer } from '../daemon/qflushd.js';
import { __resetEphemeralMemoryFallbackStore } from '../utils/ephemeral-memory.js';

function restoreEnv(name: string, value: string | undefined) {
  if (typeof value === 'undefined') {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close((err) => {
        if (err) return reject(err);
        resolve(port);
      });
    });
    srv.on('error', reject);
  });
}

let port = 0;
const baseUrl = () => `http://127.0.0.1:${port}`;

beforeAll(async () => {
  process.env.NEZ_ADMIN_TOKEN = 'test-token';
  process.env.QFLUSH_REQUIRE_AUTH = '1';
  process.env.QFLUSH_CHAT_UPSTREAM = '';
  process.env.QFLUSH_RUN_ALLOWLIST = 'a11.chat.v1,a11.memory.summary.v1';
  process.env.QFLUSH_DISABLE_REDIS = '1';
  port = await getFreePort();
  await startServer(port);
});

afterAll(async () => {
  try {
    await stopServer();
  } catch {
    // ignore test teardown errors
  }
});

describe('qflush daemon API', () => {
  it('GET /status exposes ephemeral memory status', async () => {
    const response = await fetch(`${baseUrl()}/status`);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.memory?.ephemeralFlow).toBe('a11.memory.ephemeral.v1');
    expect(body.memory?.ephemeral?.enabled).toBe(true);
  });

  it('GET /status returns structured runtime status', async () => {
    const response = await fetch(`${baseUrl()}/status`);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.ok).toBe(true);
    expect(body.service).toBe('qflush');
    expect(Array.isArray(body.flows?.available)).toBe(true);
    expect(body.flows.available).toContain('a11.chat.v1');
    expect(Array.isArray(body.flows?.allowedRun)).toBe(true);
    expect(body.flows.allowedRun).toEqual(['a11.chat.v1', 'a11.memory.summary.v1']);
    expect(Array.isArray(body.flows?.publicRun)).toBe(true);
    expect(Array.isArray(body.flows?.adminRun)).toBe(true);
    expect(body.flows.adminRun).toContain('web_fetch');
    expect(body.flows.exposure?.['fs.search']).toBe('admin');
    expect(body.health?.ready).toBe(true);
    expect(body.health?.checks?.stateDir?.ok).toBe(true);
    expect(body.health?.checks?.logsDir?.ok).toBe(true);
  });

  it('POST /run requires auth when a token is configured', async () => {
    const response = await fetch(`${baseUrl()}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ flow: 'a11.memory.summary.v1', payload: { latestUserMessage: 'bonjour' } }),
    } as any);
    expect(response.status).toBe(401);
  });

  it('POST /run executes flows with auth', async () => {
    const response = await fetch(`${baseUrl()}/run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-qflush-token': 'test-token',
      },
      body: JSON.stringify({
        flow: 'a11.memory.summary.v1',
        payload: {
          previousSummary: 'Utilisateur: Jeff',
          latestUserMessage: 'Je veux garder une trace de mon projet A11',
          recentMessages: [{ role: 'user', content: 'Je bosse sur A11' }],
        },
      }),
    } as any);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.ok).toBe(true);
    expect(String(body.output || '')).toContain('Je veux garder une trace');
  });

  it('POST /run rejects flows outside the allowlist', async () => {
    const response = await fetch(`${baseUrl()}/run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-qflush-token': 'test-token',
      },
      body: JSON.stringify({
        flow: 'web_fetch',
        payload: { url: 'https://example.com' },
      }),
    } as any);
    expect(response.status).toBe(403);
    const body = await response.json() as any;
    expect(body.error).toBe('flow_not_allowed');
    expect(body.scope).toBe('public');
    expect(body.reason).toBe('public_flow_not_allowed');
    expect(body.flow).toBe('web_fetch');
  });

  it('POST /api/admin/run allows admin flows with auth', async () => {
    const response = await fetch(`${baseUrl()}/api/admin/run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-qflush-token': 'test-token',
      },
      body: JSON.stringify({
        flow: 'fs.search',
        payload: {
          path: process.cwd(),
          pattern: 'package.json',
        },
      }),
    } as any);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('POST /api/admin/run tolerates escaped JSON payloads', async () => {
    const escapedBody = JSON.stringify({
      flow: 'fs.search',
      payload: {
        path: process.cwd(),
        pattern: 'package.json',
      },
    }).replace(/"/g, '\\"');

    const response = await fetch(`${baseUrl()}/api/admin/run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-qflush-token': 'test-token',
      },
      body: escapedBody,
    } as any);

    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('POST /api/admin/run can manage ephemeral memory with TTL', async () => {
    __resetEphemeralMemoryFallbackStore();

    const setResponse = await fetch(`${baseUrl()}/api/admin/run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-qflush-token': 'test-token',
      },
      body: JSON.stringify({
        flow: 'a11.memory.ephemeral.v1',
        payload: {
          op: 'set',
          namespace: 'tests',
          scope: 'suite',
          key: 'hello',
          value: { text: 'bonjour' },
          ttlSec: 120,
        },
      }),
    } as any);
    expect(setResponse.status).toBe(200);
    const setBody = await setResponse.json() as any;
    expect(setBody.ok).toBe(true);
    expect(setBody.item?.key).toBe('hello');

    const getResponse = await fetch(`${baseUrl()}/api/admin/run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-qflush-token': 'test-token',
      },
      body: JSON.stringify({
        flow: 'a11.memory.ephemeral.v1',
        payload: {
          op: 'get',
          namespace: 'tests',
          scope: 'suite',
          key: 'hello',
        },
      }),
    } as any);
    expect(getResponse.status).toBe(200);
    const getBody = await getResponse.json() as any;
    expect(getBody.found).toBe(true);
    expect(getBody.item?.value?.text).toBe('bonjour');
  });

  it('admin ephemeral memory endpoints work with auth', async () => {
    __resetEphemeralMemoryFallbackStore();

    const setResponse = await fetch(`${baseUrl()}/api/memory/ephemeral/set`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-qflush-token': 'test-token',
      },
      body: JSON.stringify({
        namespace: 'tests',
        scope: 'http',
        key: 'alpha',
        value: 'beta',
        ttlSec: 90,
      }),
    } as any);
    expect(setResponse.status).toBe(200);

    const listResponse = await fetch(`${baseUrl()}/api/memory/ephemeral/list?namespace=tests&scope=http`, {
      headers: {
        'x-qflush-token': 'test-token',
      },
    } as any);
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json() as any;
    expect(listBody.count).toBe(1);
    expect(listBody.items?.[0]?.key).toBe('alpha');

    const clearResponse = await fetch(`${baseUrl()}/api/memory/ephemeral/clear?namespace=tests&scope=http`, {
      method: 'DELETE',
      headers: {
        'x-qflush-token': 'test-token',
      },
    } as any);
    expect(clearResponse.status).toBe(200);
    const clearBody = await clearResponse.json() as any;
    expect(clearBody.removed).toBe(1);
  });

  it('GET /status?probe=1 exposes optional upstream probes without requiring default ollama', async () => {
    const healthPort = await getFreePort();
    const probeServer = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, service: 'local-llm' }));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false }));
    });
    await new Promise<void>((resolve) => probeServer.listen(healthPort, '127.0.0.1', () => resolve()));

    const previousLocalLlmUrl = process.env.LOCAL_LLM_URL;
    const previousLocalLlmHealthUrl = process.env.LOCAL_LLM_HEALTH_URL;
    const previousProbeUpstreams = process.env.QFLUSH_HEALTH_PROBE_UPSTREAMS;
    const previousOllamaUrl = process.env.OLLAMA_URL;

    process.env.LOCAL_LLM_URL = `http://127.0.0.1:${healthPort}`;
    process.env.LOCAL_LLM_HEALTH_URL = `http://127.0.0.1:${healthPort}/health`;
    process.env.QFLUSH_HEALTH_PROBE_UPSTREAMS = '0';
    delete process.env.OLLAMA_URL;

    try {
      const response = await fetch(`${baseUrl()}/status?probe=1`);
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.health?.upstreams?.enabled).toBe(true);
      expect(body.health?.upstreams?.live).toBe(true);
      expect(body.health?.upstreams?.results?.localCompletion?.ok).toBe(true);
      expect(body.health?.upstreams?.results?.ollama?.configured).toBe(false);
      expect(body.health?.upstreams?.results?.ollama?.ok).toBeNull();
    } finally {
      restoreEnv('LOCAL_LLM_URL', previousLocalLlmUrl);
      restoreEnv('LOCAL_LLM_HEALTH_URL', previousLocalLlmHealthUrl);
      restoreEnv('QFLUSH_HEALTH_PROBE_UPSTREAMS', previousProbeUpstreams);
      restoreEnv('OLLAMA_URL', previousOllamaUrl);
      await new Promise<void>((resolve, reject) => probeServer.close((err) => err ? reject(err) : resolve()));
    }
  });

  it('POST /v1/chat/completions uses the real chat flow wrapper', async () => {
    const response = await fetch(`${baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-qflush-token': 'test-token',
      },
      body: JSON.stringify({
        model: 'llama3.2:latest',
        messages: [
          { role: 'system', content: 'Tu es Qflush.' },
          { role: 'user', content: 'salut qflush' },
        ],
      }),
    } as any);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.object).toBe('chat.completion');
    expect(String(body.choices?.[0]?.message?.content || '')).toContain('salut qflush');
  });
});
