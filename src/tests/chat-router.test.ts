import * as http from 'node:http';
import * as net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { callChatBackend, resolveChatBackend } from '../core/chat-router.js';

const CHAT_ENV_KEYS = [
  'A11_SERVER_URL',
  'LLAMA_BASE',
  'LLM_URL',
  'LOCAL_LLM_URL',
  'OLLAMA_URL',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'QFLUSH_CHAT_MODEL',
  'QFLUSH_CHAT_N_PREDICT',
  'QFLUSH_CHAT_TEMPERATURE',
  'QFLUSH_CHAT_UPSTREAM',
  'QFLUSH_LOCAL_MODEL_HINTS',
];

const originalEnv = new Map<string, string | undefined>(
  CHAT_ENV_KEYS.map((key) => [key, process.env[key]])
);

async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => {
        if (error) return reject(error);
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

async function startJsonServer(handler: (req: http.IncomingMessage, body: any) => any) {
  const port = await getFreePort();
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', async () => {
      let parsedBody: any = {};
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        parsedBody = raw ? JSON.parse(raw) : {};
      } catch {
        parsedBody = {};
      }

      const response = await handler(req, parsedBody);
      const status = Number(response?.status || 200);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response?.body ?? {}));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });

  return {
    port,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) return reject(error);
          resolve();
        });
      });
    },
  };
}

function resetChatEnv() {
  for (const key of CHAT_ENV_KEYS) {
    const value = originalEnv.get(key);
    if (typeof value === 'undefined') {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
}

afterEach(() => {
  resetChatEnv();
});

describe('chat router', () => {
  it('prefers LOCAL_LLM_URL for local-looking models', () => {
    process.env.LOCAL_LLM_URL = 'https://local-llm.example.com';
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1';

    const resolved = resolveChatBackend({
      model: 'llama3.2:latest',
      messages: [{ role: 'user', content: 'bonjour' }],
    });

    expect(resolved.backend).toBe('local-completion');
    expect(resolved.source).toBe('LOCAL_LLM_URL');
  });

  it('calls a LOCAL_LLM_URL /completion upstream and converts the response', async () => {
    const requests: any[] = [];
    const upstream = await startJsonServer((req, body) => {
      requests.push({ method: req.method, url: req.url, body });
      if (req.url === '/completion') {
        return {
          status: 200,
          body: {
            content: `LOCAL:${body.prompt}`,
          },
        };
      }
      return { status: 404, body: { error: 'not_found' } };
    });

    process.env.LOCAL_LLM_URL = `http://127.0.0.1:${upstream.port}`;

    const result = await callChatBackend({
      model: 'llama3.2:latest',
      messages: [{ role: 'user', content: 'salut local' }],
    });

    expect(result.ok).toBe(true);
    expect(result.backend).toBe('local-completion');
    expect(String(result.output || '')).toContain('LOCAL:USER: salut local');
    expect(requests[0]?.url).toBe('/completion');
    expect(String(requests[0]?.body?.prompt || '')).toContain('ASSISTANT:');

    await upstream.close();
  });

  it('falls back across OpenAI-compatible endpoint variants', async () => {
    const upstream = await startJsonServer((req) => {
      if (req.url === '/v1/chat/completions') {
        return {
          status: 200,
          body: {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'UPSTREAM:ok',
                },
              },
            ],
          },
        };
      }
      return { status: 404, body: { error: 'not_found' } };
    });

    process.env.QFLUSH_CHAT_UPSTREAM = `http://127.0.0.1:${upstream.port}`;

    const result = await callChatBackend({
      model: 'mistral-small',
      provider: 'qflush',
      messages: [{ role: 'user', content: 'test fallback' }],
    });

    expect(result.ok).toBe(true);
    expect(result.backend).toBe('qflush-upstream');
    expect(result.output).toBe('UPSTREAM:ok');
    expect(Array.isArray(result.tried)).toBe(true);
    expect(result.tried?.[0]?.url).toContain('/chat/completions');

    await upstream.close();
  });

  it('keeps an echo fallback when no upstream is configured', async () => {
    const result = await callChatBackend({
      messages: [{ role: 'user', content: 'sans upstream' }],
    });

    expect(result.ok).toBe(true);
    expect(result.backend).toBe('echo');
    expect(result.output).toContain('sans upstream');
  });
});
