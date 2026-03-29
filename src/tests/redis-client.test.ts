import { afterEach, describe, expect, it } from 'vitest';
import { createRedisClient } from '../utils/redis.js';

const originalRedisUrl = process.env.REDIS_URL;
const originalQflushRedisUrl = process.env.QFLUSH_REDIS_URL;
const originalDisable = process.env.QFLUSH_DISABLE_REDIS;

afterEach(async () => {
  process.env.REDIS_URL = originalRedisUrl;
  process.env.QFLUSH_REDIS_URL = originalQflushRedisUrl;
  process.env.QFLUSH_DISABLE_REDIS = originalDisable;
});

describe('createRedisClient', () => {
  it('creates a Redis client in ESM mode when a URL is configured', async () => {
    process.env.QFLUSH_DISABLE_REDIS = '0';
    process.env.QFLUSH_REDIS_URL = 'redis://127.0.0.1:65535';
    delete process.env.REDIS_URL;

    const client = createRedisClient();
    expect(client).toBeTruthy();
    expect(typeof client.disconnect).toBe('function');

    client.disconnect();
  });

  it('returns null when Redis is explicitly disabled', () => {
    process.env.QFLUSH_DISABLE_REDIS = '1';
    process.env.QFLUSH_REDIS_URL = 'redis://127.0.0.1:6379';

    expect(createRedisClient()).toBeNull();
  });
});
