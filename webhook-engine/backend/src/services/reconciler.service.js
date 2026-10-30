import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { eventRepository } from '../repositories/event.repository.js';
import { deliveryRepository } from '../repositories/delivery.repository.js';
import { enqueueFanout, scheduleDelivery } from './queue.service.js';

/**
 * Postgres is the source of truth; Redis is a delivery mechanism. This sweeper re-enqueues work that
 * Postgres says should have happened but the queue lost (Redis flush/outage, crash between commit and enqueue).
 * Deterministic BullMQ job ids make duplicate enqueues no-ops, so it is safe to run on every worker instance.
 */
export async function reconcileOnce() {
  const now = Date.now();
  let events = 0;
  let deliveries = 0;

  const staleEvents = await eventRepository.findStalePending(new Date(now - 30_000));
  for (const { id } of staleEvents) {
    await enqueueFanout(id).then(() => events++).catch((err) => logger.error({ err: err.message, id }, 'reconcile fan-out failed'));
  }

  const overdue = await deliveryRepository.findOverdue(new Date(now - 60_000));
  for (const { id, nextAttemptAt } of overdue) {
    await scheduleDelivery(id, nextAttemptAt).then(() => deliveries++).catch((err) => logger.error({ err: err.message, id }, 'reconcile delivery failed'));
  }

  return { events, deliveries };
}

export function startReconciler() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await reconcileOnce();
      if (result.events || result.deliveries) logger.warn(result, 'reconciler re-enqueued orphaned work');
    } catch (err) {
      logger.error({ err: err.message }, 'reconciler run failed');
    } finally {
      running = false;
    }
  };
  tick();
  const timer = setInterval(tick, env.RECONCILE_INTERVAL_MS);
  return { stop: () => clearInterval(timer) };
}
