import IORedis from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * BullMQ requires `maxRetriesPerRequest: null` on blocking (worker) connections.
 * Producers used inside HTTP request paths set `failFast` so commands reject immediately
 * while Redis is down instead of queueing in memory and stalling the API.
 */
export function createRedisConnection({ failFast = false } = {}) {
  const connection = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: !failFast,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
  });
  connection.on('error', (err) => logger.error({ err: err.message }, 'redis connection error'));
  return connection;
}
