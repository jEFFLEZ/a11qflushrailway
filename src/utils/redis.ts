import { createRequire } from 'node:module';

// Small helper to create an optional Redis client.
// If QFLUSH_DISABLE_REDIS=1 or no URL is provided, returns null.

const require = createRequire(import.meta.url);

export function createRedisClient(): any | null {
  const DISABLED = process.env.QFLUSH_DISABLE_REDIS === '1' || String(process.env.QFLUSH_DISABLE_REDIS).toLowerCase() === 'true';
  const url = String(process.env.QFLUSH_REDIS_URL || process.env.REDIS_URL || '').trim();
  if (DISABLED || !url) return null;
  // Require lazily to avoid forcing ioredis dependency when not used
  try {
    const Redis = require('ioredis');
    const opts: any = {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    };
    return new Redis(url, opts);
  } catch (e) {
    return null;
  }
}
