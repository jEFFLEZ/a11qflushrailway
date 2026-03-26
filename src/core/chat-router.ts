import fetch from '../utils/fetch.js';

const OPENAI_COMPATIBLE_PATHS = [
  '/chat/completions',
  '/v1/chat/completions',
  '/api/chat/completions',
  '/chat',
  '/v1/chat',
];

const LOCAL_COMPLETION_PATHS = ['/completion'];
const OLLAMA_CHAT_PATHS = ['/api/chat', '/chat'];

const DEFAULT_LOCAL_MODEL_HINTS = [
  'llama',
  'mistral',
  'mixtral',
  'qwen',
  'phi',
  'gemma',
  'deepseek',
  'nous',
  'qflush',
];

const DEFAULT_OPENAI_LIKE_HINTS = ['gpt-', 'o1', 'o3', 'o4', 'o5'];

export type ChatBackendKind =
  | 'echo'
  | 'local-completion'
  | 'openai-compatible'
  | 'qflush-upstream'
  | 'ollama'
  | 'openai';

export type ChatBackendSelection = {
  backend: ChatBackendKind;
  baseUrl: string | null;
  source: string;
};

export type ChatRouterStatus = {
  localModelHints: string[];
  configuredBackends: {
    localCompletion: { configured: boolean; url: string | null };
    qflushUpstream: { configured: boolean; url: string | null };
    openaiCompatible: { configured: boolean; url: string | null };
    openai: { configured: boolean; url: string | null; hasApiKey: boolean };
    ollama: { configured: boolean; url: string | null; fallbackDefault: string | null };
  };
};

export type ChatProxyResult = {
  ok: boolean;
  output?: string;
  backend: ChatBackendKind;
  source: string;
  url?: string;
  status?: number;
  error?: string;
  tried?: Array<{ url: string; status: number }>;
};

type PostAttemptResult = {
  ok: boolean;
  status: number;
  text: string;
  url: string;
  tried: Array<{ url: string; status: number }>;
};

function trim(value: unknown): string {
  return String(value || '').trim();
}

function normalizeBase(url?: string) {
  return trim(url).replace(/\/$/, '');
}

function parseHintList(raw: string): string[] {
  return raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function flattenMessageContent(content: any): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part: any) => {
      if (!part) return '';
      if (typeof part === 'string') return part;
      if (typeof part.text === 'string') return part.text;
      if (typeof part.input_text === 'string') return part.input_text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

export function extractLatestUserMessage(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg || msg.role !== 'user') continue;
    const text = flattenMessageContent(msg.content);
    if (text) return text;
  }
  return '';
}

export function buildPromptFromMessages(messages: any[]): string {
  const lines = (Array.isArray(messages) ? messages : [])
    .map((msg: any) => {
      const role = String(msg?.role || 'user').trim().toUpperCase();
      const text = flattenMessageContent(msg?.content);
      if (!text) return '';
      return `${role}: ${text}`;
    })
    .filter(Boolean);
  if (lines.length === 0) return '';
  lines.push('ASSISTANT:');
  return lines.join('\n\n');
}

function buildMessages(payload: any): any[] {
  if (Array.isArray(payload?.messages) && payload.messages.length > 0) {
    return payload.messages;
  }
  const prompt = trim(payload?.prompt);
  if (!prompt) return [];
  return [{ role: 'user', content: prompt }];
}

function buildOpenAiCompatiblePayload(payload: any) {
  const clone = { ...(payload || {}) } as Record<string, any>;
  delete clone.provider;
  clone.model = trim(clone.model) || trim(process.env.QFLUSH_CHAT_MODEL) || 'gpt-4o-mini';
  clone.messages = buildMessages(payload);
  clone.stream = false;
  return clone;
}

function buildLocalCompletionPayload(payload: any) {
  const promptFromMessages = buildPromptFromMessages(buildMessages(payload));
  const prompt = promptFromMessages || trim(payload?.prompt);
  const body: Record<string, any> = {
    prompt,
    stream: false,
  };
  const model = trim(payload?.model);
  if (model) body.model = model;

  const temperature =
    typeof payload?.temperature === 'number'
      ? payload.temperature
      : Number(trim(process.env.QFLUSH_CHAT_TEMPERATURE) || '0.7');
  if (!Number.isNaN(temperature)) body.temperature = temperature;

  const envPredict = trim(process.env.QFLUSH_CHAT_N_PREDICT);
  const nPredictRaw =
    payload?.n_predict ??
    payload?.max_tokens ??
    (envPredict || '512');
  const nPredict = Number(nPredictRaw);
  if (!Number.isNaN(nPredict) && nPredict > 0) body.n_predict = nPredict;

  return body;
}

function getChatRouterConfig() {
  const localHints = parseHintList(trim(process.env.QFLUSH_LOCAL_MODEL_HINTS));
  const openaiUrl = normalizeBase(trim(process.env.OPENAI_BASE_URL) || 'https://api.openai.com/v1');
  const openaiApiKey = trim(process.env.OPENAI_API_KEY);
  return {
    localModelHints: localHints.length ? localHints : DEFAULT_LOCAL_MODEL_HINTS,
    localCompletionUrl: normalizeBase(process.env.LOCAL_LLM_URL),
    qflushChatUpstream: normalizeBase(process.env.QFLUSH_CHAT_UPSTREAM),
    openaiCompatibleUrl: normalizeBase(
      trim(process.env.LLAMA_BASE) ||
      trim(process.env.LLM_URL) ||
      trim(process.env.A11_SERVER_URL)
    ),
    openaiUrl,
    openaiConfigured: !!openaiApiKey || !!trim(process.env.OPENAI_BASE_URL),
    openaiApiKey,
    ollamaUrl: normalizeBase(trim(process.env.OLLAMA_URL) || 'http://127.0.0.1:11434'),
    ollamaConfigured: !!trim(process.env.OLLAMA_URL),
  };
}

function looksOpenAiLikeModel(model: string) {
  const normalized = trim(model).toLowerCase();
  return DEFAULT_OPENAI_LIKE_HINTS.some((hint) => normalized.startsWith(hint));
}

export function looksLocalLikeModel(model: string, hints?: string[]) {
  const normalized = trim(model).toLowerCase();
  return (hints && hints.length ? hints : DEFAULT_LOCAL_MODEL_HINTS)
    .some((hint) => normalized.startsWith(hint));
}

function selection(backend: ChatBackendKind, baseUrl: string | null, source: string): ChatBackendSelection {
  return { backend, baseUrl, source };
}

export function resolveChatBackend(payload: any = {}, explicitProvider = ''): ChatBackendSelection {
  const cfg = getChatRouterConfig();
  const provider = trim(explicitProvider || payload?.provider).toLowerCase();
  const model = trim(payload?.model);
  const localLike = looksLocalLikeModel(model, cfg.localModelHints);
  const openAiLike = looksOpenAiLikeModel(model);

  const localSelection = cfg.localCompletionUrl
    ? selection('local-completion', cfg.localCompletionUrl, 'LOCAL_LLM_URL')
    : null;
  const upstreamSelection = cfg.qflushChatUpstream
    ? selection('qflush-upstream', cfg.qflushChatUpstream, 'QFLUSH_CHAT_UPSTREAM')
    : null;
  const compatSelection = cfg.openaiCompatibleUrl
    ? selection('openai-compatible', cfg.openaiCompatibleUrl, 'LLAMA_BASE/LLM_URL/A11_SERVER_URL')
    : null;
  const openAiSelection = cfg.openaiConfigured
    ? selection('openai', cfg.openaiUrl, 'OPENAI_BASE_URL')
    : null;
  const ollamaSelection = provider === 'ollama' || cfg.ollamaConfigured
    ? selection('ollama', cfg.ollamaUrl, cfg.ollamaConfigured ? 'OLLAMA_URL' : 'OLLAMA_URL(default)')
    : null;

  if (provider === 'local' || provider === 'llm' || provider === 'completion') {
    return localSelection || compatSelection || upstreamSelection || ollamaSelection || selection('echo', null, 'inline');
  }
  if (provider === 'qflush' || provider === 'upstream') {
    return upstreamSelection || compatSelection || localSelection || ollamaSelection || selection('echo', null, 'inline');
  }
  if (provider === 'openai') {
    return openAiSelection || compatSelection || upstreamSelection || selection('echo', null, 'inline');
  }
  if (provider === 'ollama') {
    return ollamaSelection || selection('echo', null, 'inline');
  }

  if (localLike) {
    return localSelection || upstreamSelection || compatSelection || ollamaSelection || openAiSelection || selection('echo', null, 'inline');
  }
  if (openAiLike) {
    return openAiSelection || compatSelection || upstreamSelection || localSelection || ollamaSelection || selection('echo', null, 'inline');
  }

  return upstreamSelection || localSelection || compatSelection || openAiSelection || ollamaSelection || selection('echo', null, 'inline');
}

function buildCandidateUrls(baseUrl: string, suffixes: string[]) {
  const base = normalizeBase(baseUrl);
  const candidates: string[] = [];
  try {
    const parsed = new URL(base);
    const path = parsed.pathname.replace(/\/$/, '');
    const looksLikeEndpoint = suffixes.some((suffix) => path.endsWith(suffix.replace(/^\//, '')));
    if (looksLikeEndpoint) {
      candidates.push(base);
    }
  } catch {
    // ignore malformed URLs here; fetch will surface it later
  }
  for (const suffix of suffixes) {
    candidates.push(`${base}${suffix.startsWith('/') ? suffix : `/${suffix}`}`);
  }
  return Array.from(new Set(candidates));
}

async function postJsonWithFallback(
  baseUrl: string,
  suffixes: string[],
  payload: any,
  headers: Record<string, string> = {}
): Promise<PostAttemptResult> {
  const tried: Array<{ url: string; status: number }> = [];
  const candidates = buildCandidateUrls(baseUrl, suffixes);

  for (const url of candidates) {
    let response: any;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(payload),
      } as any);
    } catch (error) {
      tried.push({ url, status: 0 });
      continue;
    }

    const text = await response.text();
    if (response.ok) {
      return {
        ok: true,
        status: response.status,
        text,
        url,
        tried,
      };
    }

    tried.push({ url, status: response.status });
    if (response.status !== 404 && response.status !== 403) {
      return {
        ok: false,
        status: response.status,
        text,
        url,
        tried,
      };
    }
  }

  const last = tried[tried.length - 1] || { url: baseUrl, status: 0 };
  return {
    ok: false,
    status: last.status || 502,
    text: 'upstream_unreachable',
    url: last.url,
    tried,
  };
}

function extractOutputFromText(text: string): string {
  try {
    const parsed = text ? JSON.parse(text) : {};
    return (
      parsed?.choices?.[0]?.message?.content ||
      parsed?.message?.content ||
      parsed?.content ||
      parsed?.response ||
      parsed?.output ||
      parsed?.text ||
      ''
    );
  } catch {
    return trim(text);
  }
}

async function callOpenAiCompatibleBackend(selectionInfo: ChatBackendSelection, payload: any): Promise<ChatProxyResult> {
  const headers: Record<string, string> = {};
  const apiKey = trim(process.env.OPENAI_API_KEY);
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const result = await postJsonWithFallback(
    selectionInfo.baseUrl || '',
    OPENAI_COMPATIBLE_PATHS,
    buildOpenAiCompatiblePayload(payload),
    headers
  );

  if (!result.ok) {
    return {
      ok: false,
      backend: selectionInfo.backend,
      source: selectionInfo.source,
      status: result.status,
      error: result.text,
      url: result.url,
      tried: result.tried,
    };
  }

  return {
    ok: true,
    backend: selectionInfo.backend,
    source: selectionInfo.source,
    status: result.status,
    output: extractOutputFromText(result.text),
    url: result.url,
    tried: result.tried,
  };
}

async function callLocalCompletionBackend(selectionInfo: ChatBackendSelection, payload: any): Promise<ChatProxyResult> {
  const result = await postJsonWithFallback(
    selectionInfo.baseUrl || '',
    LOCAL_COMPLETION_PATHS,
    buildLocalCompletionPayload(payload)
  );

  if (!result.ok) {
    return {
      ok: false,
      backend: selectionInfo.backend,
      source: selectionInfo.source,
      status: result.status,
      error: result.text,
      url: result.url,
      tried: result.tried,
    };
  }

  return {
    ok: true,
    backend: selectionInfo.backend,
    source: selectionInfo.source,
    status: result.status,
    output: extractOutputFromText(result.text),
    url: result.url,
    tried: result.tried,
  };
}

async function callOllamaBackend(selectionInfo: ChatBackendSelection, payload: any): Promise<ChatProxyResult> {
  const result = await postJsonWithFallback(
    selectionInfo.baseUrl || '',
    OLLAMA_CHAT_PATHS,
    {
      model: trim(payload?.model) || trim(process.env.QFLUSH_CHAT_MODEL) || 'llama3.2',
      messages: buildMessages(payload),
      stream: false,
    }
  );

  if (!result.ok) {
    return {
      ok: false,
      backend: selectionInfo.backend,
      source: selectionInfo.source,
      status: result.status,
      error: result.text,
      url: result.url,
      tried: result.tried,
    };
  }

  return {
    ok: true,
    backend: selectionInfo.backend,
    source: selectionInfo.source,
    status: result.status,
    output: extractOutputFromText(result.text),
    url: result.url,
    tried: result.tried,
  };
}

export async function callChatBackend(payload: any = {}, explicitProvider = ''): Promise<ChatProxyResult> {
  const chosen = resolveChatBackend(payload, explicitProvider);
  if (chosen.backend === 'echo') {
    return {
      ok: true,
      backend: 'echo',
      source: 'inline',
      output: `Echo: ${extractLatestUserMessage(buildMessages(payload)) || trim(payload?.prompt)}`,
    };
  }

  if (chosen.backend === 'local-completion') {
    return await callLocalCompletionBackend(chosen, payload);
  }

  if (chosen.backend === 'ollama') {
    return await callOllamaBackend(chosen, payload);
  }

  return await callOpenAiCompatibleBackend(chosen, payload);
}

export function buildChatRouterStatus(): ChatRouterStatus {
  const cfg = getChatRouterConfig();
  return {
    localModelHints: cfg.localModelHints,
    configuredBackends: {
      localCompletion: {
        configured: !!cfg.localCompletionUrl,
        url: cfg.localCompletionUrl || null,
      },
      qflushUpstream: {
        configured: !!cfg.qflushChatUpstream,
        url: cfg.qflushChatUpstream || null,
      },
      openaiCompatible: {
        configured: !!cfg.openaiCompatibleUrl,
        url: cfg.openaiCompatibleUrl || null,
      },
      openai: {
        configured: cfg.openaiConfigured,
        url: cfg.openaiConfigured ? cfg.openaiUrl : null,
        hasApiKey: !!cfg.openaiApiKey,
      },
      ollama: {
        configured: cfg.ollamaConfigured,
        url: cfg.ollamaConfigured ? cfg.ollamaUrl : null,
        fallbackDefault: cfg.ollamaUrl || null,
      },
    },
  };
}
