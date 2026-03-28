import { createRedisClient } from './redis.js';

type Primitive = string | number | boolean | null;
type JsonValue = Primitive | JsonValue[] | { [key: string]: JsonValue };

export type EphemeralMemoryValue = JsonValue;

export type EphemeralMemoryRecord = {
  key: string;
  namespace: string;
  scope: string;
  value: EphemeralMemoryValue;
  metadata?: Record<string, JsonValue>;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  ttlSec: number;
  ttlRemainingSec: number;
  storageKey: string;
};

type StoredEphemeralMemoryRecord = Omit<EphemeralMemoryRecord, 'ttlRemainingSec'> & {
  expiresAtMs: number;
};

type SetEphemeralMemoryInput = {
  key: string;
  value: EphemeralMemoryValue;
  ttlSec?: number;
  namespace?: string;
  scope?: string;
  metadata?: Record<string, JsonValue>;
};

type GetEphemeralMemoryInput = {
  key: string;
  namespace?: string;
  scope?: string;
};

type DeleteEphemeralMemoryInput = GetEphemeralMemoryInput;

type ListEphemeralMemoryInput = {
  namespace?: string;
  scope?: string;
  prefix?: string;
  limit?: number;
};

type ClearEphemeralMemoryInput = {
  namespace?: string;
  scope?: string;
  prefix?: string;
};

type TouchEphemeralMemoryInput = {
  key: string;
  ttlSec?: number;
  namespace?: string;
  scope?: string;
};

const DEFAULT_TTL_SEC = Math.max(30, Number(process.env.QFLUSH_EPHEMERAL_MEMORY_TTL_SEC || 3600));
const MAX_TTL_SEC = Math.max(DEFAULT_TTL_SEC, Number(process.env.QFLUSH_EPHEMERAL_MEMORY_MAX_TTL_SEC || 86400));
const DEFAULT_NAMESPACE = String(process.env.QFLUSH_EPHEMERAL_MEMORY_NAMESPACE || 'a11').trim() || 'a11';
const DEFAULT_SCOPE = String(process.env.QFLUSH_EPHEMERAL_MEMORY_SCOPE || 'shared').trim() || 'shared';
const STORAGE_PREFIX = String(process.env.QFLUSH_EPHEMERAL_MEMORY_PREFIX || 'qflush:ephemeral').trim() || 'qflush:ephemeral';

const fallbackStore = new Map<string, StoredEphemeralMemoryRecord>();
let redisClient: any | undefined;
let redisDisabled = false;

function nowMs() {
  return Date.now();
}

function toIso(timestampMs: number) {
  return new Date(timestampMs).toISOString();
}

function clampTtl(ttlSec?: number) {
  const numeric = Number(ttlSec);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_TTL_SEC;
  return Math.max(30, Math.min(MAX_TTL_SEC, Math.round(numeric)));
}

function normalizeSegment(value: unknown, fallback: string) {
  const normalized = String(value || '')
    .trim()
    .replace(/[\s/\\]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function normalizeKey(value: unknown) {
  return normalizeSegment(value, '');
}

function resolveNamespace(value?: string) {
  return normalizeSegment(value, DEFAULT_NAMESPACE);
}

function resolveScope(value?: string) {
  return normalizeSegment(value, DEFAULT_SCOPE);
}

function encodeKeySegment(value: string) {
  return encodeURIComponent(value);
}

function decodeKeySegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function buildStorageKey({ namespace, scope, key }: { namespace: string; scope: string; key: string }) {
  return `${STORAGE_PREFIX}:${encodeKeySegment(namespace)}:${encodeKeySegment(scope)}:${encodeKeySegment(key)}`;
}

function parseStorageKey(storageKey: string) {
  const parts = String(storageKey || '').split(':');
  if (parts.length < 4) return null;
  const key = decodeKeySegment(parts.slice(3).join(':'));
  return {
    namespace: decodeKeySegment(parts[1] || ''),
    scope: decodeKeySegment(parts[2] || ''),
    key,
  };
}

function normalizeRecord(record: StoredEphemeralMemoryRecord, ttlRemainingSec?: number): EphemeralMemoryRecord {
  const computedRemaining = Number.isFinite(Number(ttlRemainingSec))
    ? Math.max(0, Math.round(Number(ttlRemainingSec)))
    : Math.max(0, Math.ceil((record.expiresAtMs - nowMs()) / 1000));
  return {
    key: record.key,
    namespace: record.namespace,
    scope: record.scope,
    value: record.value,
    metadata: record.metadata,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt,
    ttlSec: record.ttlSec,
    ttlRemainingSec: computedRemaining,
    storageKey: record.storageKey,
  };
}

function cleanupFallbackStore() {
  const current = nowMs();
  for (const [key, record] of fallbackStore.entries()) {
    if (record.expiresAtMs <= current) {
      fallbackStore.delete(key);
    }
  }
}

async function getRedisClient() {
  if (redisDisabled) return null;
  if (typeof redisClient !== 'undefined') return redisClient;
  redisClient = createRedisClient();
  if (!redisClient) {
    redisDisabled = true;
    return null;
  }
  try {
    if (typeof redisClient.on === 'function') {
      redisClient.on('error', () => undefined);
    }
  } catch {
    // ignore best-effort listener binding
  }
  return redisClient;
}

async function tryRedis<T>(fn: (client: any) => Promise<T>): Promise<T | null> {
  const client = await getRedisClient();
  if (!client) return null;
  try {
    return await fn(client);
  } catch {
    return null;
  }
}

function buildStoredRecord(input: SetEphemeralMemoryInput): StoredEphemeralMemoryRecord {
  const key = normalizeKey(input.key);
  if (!key) {
    throw new Error('ephemeral_memory: missing key');
  }
  const namespace = resolveNamespace(input.namespace);
  const scope = resolveScope(input.scope);
  const ttlSec = clampTtl(input.ttlSec);
  const createdAtMs = nowMs();
  const expiresAtMs = createdAtMs + (ttlSec * 1000);
  const storageKey = buildStorageKey({ namespace, scope, key });
  return {
    key,
    namespace,
    scope,
    value: input.value,
    metadata: input.metadata,
    createdAt: toIso(createdAtMs),
    updatedAt: toIso(createdAtMs),
    expiresAt: toIso(expiresAtMs),
    expiresAtMs,
    ttlSec,
    storageKey,
  };
}

export async function setEphemeralMemory(input: SetEphemeralMemoryInput) {
  const record = buildStoredRecord(input);
  const redisSaved = await tryRedis(async (client) => {
    await client.set(record.storageKey, JSON.stringify(record), 'EX', record.ttlSec);
    return true;
  });
  if (!redisSaved) {
    fallbackStore.set(record.storageKey, record);
  }
  return {
    ok: true,
    backend: redisSaved ? 'redis' : 'memory',
    item: normalizeRecord(record, record.ttlSec),
  };
}

export async function getEphemeralMemory(input: GetEphemeralMemoryInput) {
  const key = normalizeKey(input.key);
  if (!key) {
    throw new Error('ephemeral_memory: missing key');
  }
  const namespace = resolveNamespace(input.namespace);
  const scope = resolveScope(input.scope);
  const storageKey = buildStorageKey({ namespace, scope, key });

  const redisResult = await tryRedis(async (client) => {
    const [raw, ttl] = await Promise.all([
      client.get(storageKey),
      client.ttl(storageKey),
    ]);
    if (!raw) return { found: false };
    const parsed = JSON.parse(String(raw || '{}')) as StoredEphemeralMemoryRecord;
    return {
      found: true,
      item: normalizeRecord(parsed, ttl),
      backend: 'redis',
    };
  });

  if (redisResult) {
    if (!redisResult.found) {
      return { ok: true, found: false, backend: 'redis', key, namespace, scope };
    }
    return { ok: true, found: true, backend: 'redis', item: redisResult.item };
  }

  cleanupFallbackStore();
  const record = fallbackStore.get(storageKey);
  if (!record) {
    return { ok: true, found: false, backend: 'memory', key, namespace, scope };
  }
  return { ok: true, found: true, backend: 'memory', item: normalizeRecord(record) };
}

export async function deleteEphemeralMemory(input: DeleteEphemeralMemoryInput) {
  const key = normalizeKey(input.key);
  if (!key) {
    throw new Error('ephemeral_memory: missing key');
  }
  const namespace = resolveNamespace(input.namespace);
  const scope = resolveScope(input.scope);
  const storageKey = buildStorageKey({ namespace, scope, key });

  const redisResult = await tryRedis(async (client) => {
    const deleted = await client.del(storageKey);
    return Number(deleted || 0) > 0;
  });

  if (typeof redisResult === 'boolean') {
    return { ok: true, backend: 'redis', deleted: redisResult, key, namespace, scope };
  }

  const deleted = fallbackStore.delete(storageKey);
  return { ok: true, backend: 'memory', deleted, key, namespace, scope };
}

export async function touchEphemeralMemory(input: TouchEphemeralMemoryInput) {
  const existing = await getEphemeralMemory(input);
  if (!existing.found || !existing.item) {
    return { ok: true, backend: existing.backend, touched: false, key: input.key };
  }
  return await setEphemeralMemory({
    key: existing.item.key,
    namespace: existing.item.namespace,
    scope: existing.item.scope,
    value: existing.item.value,
    metadata: existing.item.metadata,
    ttlSec: input.ttlSec || existing.item.ttlSec,
  });
}

async function listRedisKeys(client: any, matchPattern: string, limit: number) {
  const matches: string[] = [];
  let cursor = '0';
  do {
    const result = await client.scan(cursor, 'MATCH', matchPattern, 'COUNT', Math.max(20, limit));
    cursor = String(Array.isArray(result) ? result[0] : '0');
    const batch = Array.isArray(result) && Array.isArray(result[1]) ? result[1] : [];
    for (const key of batch) {
      if (!matches.includes(String(key))) {
        matches.push(String(key));
      }
      if (matches.length >= limit) {
        return matches;
      }
    }
  } while (cursor !== '0');
  return matches;
}

export async function listEphemeralMemory(input: ListEphemeralMemoryInput = {}) {
  const namespace = resolveNamespace(input.namespace);
  const scope = resolveScope(input.scope);
  const prefix = normalizeKey(input.prefix || '');
  const limit = Math.max(1, Math.min(100, Number(input.limit || 20)));
  const matchPattern = `${STORAGE_PREFIX}:${encodeKeySegment(namespace)}:${encodeKeySegment(scope)}:${prefix ? `${encodeKeySegment(prefix)}*` : '*'}`;

  const redisResult = await tryRedis(async (client) => {
    const keys = await listRedisKeys(client, matchPattern, limit);
    const items: EphemeralMemoryRecord[] = [];
    for (const storageKey of keys) {
      const [raw, ttl] = await Promise.all([client.get(storageKey), client.ttl(storageKey)]);
      if (!raw) continue;
      const parsed = JSON.parse(String(raw || '{}')) as StoredEphemeralMemoryRecord;
      items.push(normalizeRecord(parsed, ttl));
      if (items.length >= limit) break;
    }
    items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return items;
  });

  if (redisResult) {
    return {
      ok: true,
      backend: 'redis',
      namespace,
      scope,
      count: redisResult.length,
      items: redisResult,
    };
  }

  cleanupFallbackStore();
  const items = Array.from(fallbackStore.values())
    .filter((record) => record.namespace === namespace && record.scope === scope)
    .filter((record) => !prefix || record.key.startsWith(prefix))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, limit)
    .map((record) => normalizeRecord(record));

  return {
    ok: true,
    backend: 'memory',
    namespace,
    scope,
    count: items.length,
    items,
  };
}

export async function clearEphemeralMemory(input: ClearEphemeralMemoryInput = {}) {
  const namespace = resolveNamespace(input.namespace);
  const scope = resolveScope(input.scope);
  const prefix = normalizeKey(input.prefix || '');
  const matchPattern = `${STORAGE_PREFIX}:${encodeKeySegment(namespace)}:${encodeKeySegment(scope)}:${prefix ? `${encodeKeySegment(prefix)}*` : '*'}`;

  const redisResult = await tryRedis(async (client) => {
    const keys = await listRedisKeys(client, matchPattern, 1000);
    if (!keys.length) return 0;
    const removed = await client.del(...keys);
    return Number(removed || 0);
  });

  if (typeof redisResult === 'number') {
    return { ok: true, backend: 'redis', removed: redisResult, namespace, scope, prefix: prefix || null };
  }

  cleanupFallbackStore();
  let removed = 0;
  for (const [storageKey, record] of fallbackStore.entries()) {
    if (record.namespace !== namespace || record.scope !== scope) continue;
    if (prefix && !record.key.startsWith(prefix)) continue;
    fallbackStore.delete(storageKey);
    removed += 1;
  }
  return { ok: true, backend: 'memory', removed, namespace, scope, prefix: prefix || null };
}

export function getEphemeralMemoryStatus() {
  cleanupFallbackStore();
  const redisEnabled = !redisDisabled && (
    String(process.env.QFLUSH_ENABLE_REDIS || '').trim() === '1'
    || String(process.env.QFLUSH_DISABLE_REDIS || '').trim() !== '1'
  ) && Boolean(String(process.env.QFLUSH_REDIS_URL || process.env.REDIS_URL || '').trim());
  return {
    enabled: true,
    backend: redisEnabled ? 'redis-preferred' : 'memory-fallback',
    redisConfigured: Boolean(String(process.env.QFLUSH_REDIS_URL || process.env.REDIS_URL || '').trim()),
    redisDisabled,
    defaultTtlSec: DEFAULT_TTL_SEC,
    maxTtlSec: MAX_TTL_SEC,
    defaultNamespace: DEFAULT_NAMESPACE,
    defaultScope: DEFAULT_SCOPE,
    storagePrefix: STORAGE_PREFIX,
    fallbackItems: fallbackStore.size,
  };
}

export function __resetEphemeralMemoryFallbackStore() {
  fallbackStore.clear();
  redisClient = undefined;
  redisDisabled = false;
}
