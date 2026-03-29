// ROME-TAG: 0xC27F4F

import { v4 as uuidv4 } from 'uuid';
import { getNpzNamespace } from './npz-config.js';
import { createRedisClient } from './redis.js';

const NS = getNpzNamespace();
const TTL_SEC = 24 * 3600;
const KEY_PREFIX = `qflush:${NS}:npz:request`;

type RedisNpzRecord = { id: string; laneId?: number; ts: number; meta?: Record<string, any> };

const store = new Map<string, RedisNpzRecord & { expiresAt?: number }>();
let redisClient: any | undefined;
let redisDisabled = false;

function nowMs() { return Date.now(); }
function keyFor(id: string) { return `${KEY_PREFIX}:${id}`; }

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
  } catch {}
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

export async function createRecord(meta?: Record<string, any>) {
  const id = uuidv4();
  const rec: RedisNpzRecord = { id, ts: nowMs(), meta };
  const expiresAt = nowMs() + 24 * 3600 * 1000;
  const redisSaved = await tryRedis(async (client) => {
    await client.set(keyFor(id), JSON.stringify(rec), 'EX', TTL_SEC);
    return true;
  });
  if (!redisSaved) {
    store.set(id, Object.assign({}, rec, { expiresAt }));
  }
  return rec;
}

export async function updateRecord(id: string, patch: Partial<RedisNpzRecord>) {
  const redisUpdated = await tryRedis(async (client) => {
    const storageKey = keyFor(id);
    const [raw, ttl] = await Promise.all([
      client.get(storageKey),
      client.ttl(storageKey),
    ]);
    if (!raw) return null;
    const entry = JSON.parse(String(raw || '{}')) as RedisNpzRecord;
    const updated = Object.assign({}, entry, patch, { id });
    const ttlSec = Number(ttl) > 0 ? Number(ttl) : TTL_SEC;
    await client.set(storageKey, JSON.stringify(updated), 'EX', ttlSec);
    return updated;
  });
  if (redisUpdated) return redisUpdated;

  const entry = store.get(id);
  if (!entry) return null;
  const updated = Object.assign({}, entry, patch, { id });
  store.set(id, updated);
  const copy = Object.assign({}, updated);
  delete (copy as any).expiresAt;
  return copy;
}

export async function getRecord(id: string) {
  const redisRecord = await tryRedis(async (client) => {
    const raw = await client.get(keyFor(id));
    if (!raw) return null;
    return JSON.parse(String(raw || '{}')) as RedisNpzRecord;
  });
  if (redisRecord) return redisRecord;

  const entry = store.get(id);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt < nowMs()) {
    store.delete(id);
    return null;
  }
  const copy = Object.assign({}, entry);
  delete (copy as any).expiresAt;
  return copy;
}

export async function deleteRecord(id: string) {
  const redisDeleted = await tryRedis(async (client) => {
    const deleted = await client.del(keyFor(id));
    return Number(deleted || 0) > 0;
  });
  if (typeof redisDeleted === 'boolean') return redisDeleted;
  return store.delete(id);
}

export async function listRecords() {
  const redisRecords = await tryRedis(async (client) => {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const result = await client.scan(cursor, 'MATCH', `${KEY_PREFIX}:*`, 'COUNT', 100);
      cursor = String(Array.isArray(result) ? result[0] : '0');
      const batch = Array.isArray(result) && Array.isArray(result[1]) ? result[1] : [];
      for (const key of batch) {
        keys.push(String(key));
      }
    } while (cursor !== '0');
    if (!keys.length) return [] as RedisNpzRecord[];
    const rawItems = await client.mget(...keys);
    return rawItems
      .filter(Boolean)
      .map((raw: string) => JSON.parse(String(raw || '{}')) as RedisNpzRecord);
  });
  if (redisRecords) return redisRecords;

  const now = nowMs();
  const res: Array<RedisNpzRecord> = [];
  for (const [k, v] of store.entries()) {
    if (v.expiresAt && v.expiresAt < now) { store.delete(k); continue; }
    const copy = Object.assign({}, v);
    delete (copy as any).expiresAt;
    res.push(copy);
  }
  return res;
}

export async function clearAll() {
  const redisCleared = await tryRedis(async (client) => {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const result = await client.scan(cursor, 'MATCH', `${KEY_PREFIX}:*`, 'COUNT', 100);
      cursor = String(Array.isArray(result) ? result[0] : '0');
      const batch = Array.isArray(result) && Array.isArray(result[1]) ? result[1] : [];
      for (const key of batch) {
        keys.push(String(key));
      }
    } while (cursor !== '0');
    if (!keys.length) return 0;
    const removed = await client.del(...keys);
    return Number(removed || 0);
  });
  if (typeof redisCleared === 'number') return redisCleared;

  const n = store.size;
  store.clear();
  return n;
}

// helper: not part of original API but useful for tests
export function __internal_size() { return store.size; }
