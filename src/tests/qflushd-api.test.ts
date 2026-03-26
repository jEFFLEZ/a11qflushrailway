import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import net from 'node:net';
import fetch from '../utils/fetch.js';
import { startServer, stopServer } from '../daemon/qflushd.js';

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
  process.env.QFLUSH_TOKEN = 'test-token';
  process.env.QFLUSH_REQUIRE_AUTH = '1';
  process.env.QFLUSH_CHAT_UPSTREAM = '';
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
  it('GET /status returns structured runtime status', async () => {
    const response = await fetch(`${baseUrl()}/status`);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.ok).toBe(true);
    expect(body.service).toBe('qflush');
    expect(Array.isArray(body.flows?.available)).toBe(true);
    expect(body.flows.available).toContain('a11.chat.v1');
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
