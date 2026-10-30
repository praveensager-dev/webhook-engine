import { logger } from '../config/logger.js';
import { deliveryRepository } from '../repositories/delivery.repository.js';
import { AppError } from '../utils/AppError.js';
import { computeRetryDelayMs } from './backoff.service.js';
import { sendWebhook } from './httpDispatcher.service.js';
import { scheduleDelivery } from './queue.service.js';

/** The exact bytes that are signed are the exact bytes that are sent. */
function buildRequestBody(event) {
  return JSON.stringify({
    id: event.id,
    type: event.eventType,
    created_at: event.createdAt.toISOString(),
    data: event.payload,
  });
}

export const deliveryService = {
  /**
   * Executes one attempt for a delivery and persists the outcome.
   * HTTP failures never throw (they are data). Only infrastructure errors throw, which lets BullMQ retry the job.
   */
  async processDelivery(deliveryId) {
    const delivery = await deliveryRepository.findForDispatch(deliveryId);
    if (!delivery) return { skipped: 'not_found' };
    if (!['PENDING', 'RETRYING'].includes(delivery.status)) return { skipped: `status_${delivery.status}` };

    if (!delivery.endpoint.isActive) {
      await deliveryRepository.markFailed(delivery.id, 'Endpoint is disabled');
      return { skipped: 'endpoint_disabled' };
    }

    const attemptNumber = delivery.attemptCount + 1;
    const outcome = await sendWebhook({
      url: delivery.endpoint.url,
      secret: delivery.endpoint.secretKey,
      body: buildRequestBody(delivery.event),
      headers: {
        'x-webhook-id': delivery.event.id,
        'x-webhook-delivery-id': delivery.id,
        'x-webhook-attempt': String(attemptNumber),
      },
    });

    let update;
    let retryAt = null;
    if (outcome.ok) {
      update = { status: 'SUCCEEDED', nextAttemptAt: null, deliveredAt: new Date() };
    } else {
      const delayMs = computeRetryDelayMs(attemptNumber);
      if (delayMs === null) {
        update = { status: 'FAILED', nextAttemptAt: null };
      } else {
        retryAt = new Date(Date.now() + delayMs);
        update = { status: 'RETRYING', nextAttemptAt: retryAt };
      }
    }

    const recorded = await deliveryRepository.recordAttempt({
      deliveryId: delivery.id,
      expectedAttemptCount: delivery.attemptCount,
      attempt: {
        attemptNumber,
        success: outcome.ok,
        statusCode: outcome.statusCode,
        error: outcome.error,
        responseSnippet: outcome.responseSnippet,
        durationMs: outcome.durationMs,
      },
      update,
    });
    if (!recorded) return { skipped: 'concurrent_update' };

    if (retryAt) {
      // State is already durable in Postgres; if this enqueue fails the reconciler re-schedules it.
      await scheduleDelivery(delivery.id, retryAt).catch((err) =>
        logger.error({ err: err.message, deliveryId: delivery.id }, 'retry enqueue failed; reconciler will retry'),
      );
    }

    logger.info(
      { deliveryId: delivery.id, attemptNumber, statusCode: outcome.statusCode, status: update.status },
      'webhook attempt finished',
    );
    return { status: update.status, attemptNumber };
  },

  /** Manual retry from the dashboard. Resets the retry budget and queues an immediate attempt. */
  async redeliver(deliveryId) {
    const existing = await deliveryRepository.findById(deliveryId);
    if (!existing) throw AppError.notFound('Delivery not found');

    const runAt = new Date();
    const reset = await deliveryRepository.resetForRedelivery(deliveryId, runAt);
    if (!reset) {
      throw AppError.conflict('Delivery is already queued or in progress', 'DELIVERY_IN_PROGRESS');
    }

    scheduleDelivery(deliveryId, runAt).catch((err) =>
      logger.error({ err: err.message, deliveryId }, 'redeliver enqueue failed; reconciler will retry'),
    );
    return deliveryRepository.findById(deliveryId);
  },

  list: (filters) => deliveryRepository.list(filters),

  async get(id) {
    const delivery = await deliveryRepository.findById(id);
    if (!delivery) throw AppError.notFound('Delivery not found');
    return delivery;
  },
};
