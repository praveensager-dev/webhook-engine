import { Queue } from 'bullmq';
import { createRedisConnection } from '../db/redis.js';
import { logger } from '../config/logger.js';

export const QUEUE_NAMES = Object.freeze({
  FANOUT: 'event-fanout',
  DELIVERY: 'webhook-delivery',
});

// Producer connection fails fast when Redis is down, so HTTP handlers never hang on the queue.
const connection = createRedisConnection({ failFast: true });

/**
 * BullMQ `attempts` covers *infrastructure* failures (DB blip, crash mid-job).
 * Business retries (the endpoint returned 500) are scheduled explicitly with exponential backoff
 * and persisted in Postgres, so they are visible, auditable and survive a Redis flush.
 */
const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: true,
  removeOnFail: true,
};

const fanoutQueue = new Queue(QUEUE_NAMES.FANOUT, { connection, defaultJobOptions });
const deliveryQueue = new Queue(QUEUE_NAMES.DELIVERY, { connection, defaultJobOptions });
[fanoutQueue, deliveryQueue].forEach((q) =>
  q.on('error', (err) => logger.error({ err: err.message, queue: q.name }, 'queue error')),
);

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Deterministic job id => enqueueing the same work twice is a no-op (safe for the reconciler to retry). */
export const enqueueFanout = (eventId) =>
  withTimeout(fanoutQueue.add('fanout', { eventId }, { jobId: `fanout_${eventId}` }), 2000, 'enqueueFanout');

export function scheduleDelivery(deliveryId, runAt = new Date()) {
  const at = new Date(runAt);
  const delay = Math.max(0, at.getTime() - Date.now());
  return withTimeout(
    deliveryQueue.add('deliver', { deliveryId }, { jobId: `delivery_${deliveryId}_${at.getTime()}`, delay }),
    2000,
    'scheduleDelivery',
  );
}

export async function pingQueue() {
  const client = await fanoutQueue.client;
  return withTimeout(client.ping(), 1500, 'redis ping');
}

export async function closeQueues() {
  await Promise.allSettled([fanoutQueue.close(), deliveryQueue.close()]);
  await connection.quit().catch(() => {});
}
