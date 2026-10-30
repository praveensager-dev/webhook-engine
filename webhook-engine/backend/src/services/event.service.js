import { withTransaction } from '../db/prisma.js';
import { logger } from '../config/logger.js';
import { eventRepository } from '../repositories/event.repository.js';
import { endpointRepository } from '../repositories/endpoint.repository.js';
import { deliveryRepository } from '../repositories/delivery.repository.js';
import { enqueueFanout, scheduleDelivery } from './queue.service.js';

export const eventService = {
  /**
   * Ingestion path. Persist first (the events table is the outbox), then hand off to the queue.
   * The enqueue is deliberately not awaited: the HTTP response never depends on Redis latency,
   * and if the enqueue fails the reconciler re-enqueues any event still PENDING.
   */
  async ingest({ eventType, payload, idempotencyKey }) {
    if (idempotencyKey) {
      const existing = await eventRepository.findByIdempotencyKey(idempotencyKey);
      if (existing) return { event: existing, replayed: true };
    }

    let event;
    try {
      event = await eventRepository.create({ eventType, payload, idempotencyKey });
    } catch (err) {
      // Two concurrent requests with the same Idempotency-Key: the unique index decides the winner.
      if (err?.code === 'P2002' && idempotencyKey) {
        const existing = await eventRepository.findByIdempotencyKey(idempotencyKey);
        if (existing) return { event: existing, replayed: true };
      }
      throw err;
    }

    enqueueFanout(event.id).catch((err) =>
      logger.error({ err: err.message, eventId: event.id }, 'fan-out enqueue failed; reconciler will retry'),
    );
    return { event, replayed: false };
  },

  /**
   * Worker path. In one transaction: find subscribed endpoints, create one delivery row each,
   * and mark the event DISPATCHED. Safe to run twice (unique index + skipDuplicates).
   */
  async fanOut(eventId) {
    const event = await eventRepository.findById(eventId);
    if (!event) return { skipped: 'event_not_found' };
    if (event.status === 'DISPATCHED') return { skipped: 'already_dispatched' };

    const pending = await withTransaction(async (tx) => {
      const endpoints = await endpointRepository.findActiveForEventType(event.eventType, tx);
      await deliveryRepository.createManyForEvent(event.id, endpoints.map((e) => e.id), new Date(), tx);
      await eventRepository.markDispatched(event.id, tx);
      return deliveryRepository.findPendingByEvent(event.id, tx);
    });

    // Deliveries are committed; if any enqueue fails the reconciler picks up the overdue rows.
    const results = await Promise.allSettled(pending.map((d) => scheduleDelivery(d.id, d.nextAttemptAt)));
    results
      .filter((r) => r.status === 'rejected')
      .forEach((r) => logger.error({ err: r.reason?.message, eventId }, 'delivery enqueue failed; reconciler will retry'));

    return { deliveries: pending.length };
  },
};
