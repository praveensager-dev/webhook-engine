import { prisma, withTransaction } from '../db/prisma.js';

const summaryInclude = {
  endpoint: { select: { id: true, url: true } },
  event: { select: { id: true, eventType: true } },
};

export const deliveryRepository = {
  /** Idempotent fan-out: the (event_id, endpoint_id) unique index + skipDuplicates makes retries safe. */
  createManyForEvent: (eventId, endpointIds, runAt, db = prisma) =>
    db.webhookDelivery.createMany({
      data: endpointIds.map((endpointId) => ({ eventId, endpointId, nextAttemptAt: runAt })),
      skipDuplicates: true,
    }),

  findPendingByEvent: (eventId, db = prisma) =>
    db.webhookDelivery.findMany({
      where: { eventId, status: 'PENDING', attemptCount: 0 },
      select: { id: true, nextAttemptAt: true },
    }),

  findForDispatch: (id, db = prisma) =>
    db.webhookDelivery.findUnique({ where: { id }, include: { endpoint: true, event: true } }),

  findById: (id, db = prisma) =>
    db.webhookDelivery.findUnique({
      where: { id },
      include: { ...summaryInclude, attempts: { orderBy: { createdAt: 'desc' }, take: 50 } },
    }),

  /** Cursor-paginated log, newest first. Fetches limit+1 rows to learn whether another page exists. */
  async list({ endpointId, status, limit, cursor }, db = prisma) {
    const rows = await db.webhookDelivery.findMany({
      where: { ...(endpointId && { endpointId }), ...(status && { status }) },
      include: summaryInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor && { cursor: { id: cursor } }),
    });
    const hasMore = rows.length > limit;
    return { items: hasMore ? rows.slice(0, limit) : rows, nextCursor: hasMore ? rows[limit].id : null };
  },

  /**
   * Atomically records one attempt and advances the delivery state machine.
   * The `attemptCount` predicate is an optimistic lock: if another worker already recorded
   * this attempt (duplicate job), nothing is written and `false` is returned.
   */
  recordAttempt({ deliveryId, expectedAttemptCount, attempt, update }) {
    return withTransaction(async (tx) => {
      const result = await tx.webhookDelivery.updateMany({
        where: {
          id: deliveryId,
          attemptCount: expectedAttemptCount,
          status: { in: ['PENDING', 'RETRYING'] },
        },
        data: {
          ...update,
          attemptCount: attempt.attemptNumber,
          lastStatusCode: attempt.statusCode,
          lastError: attempt.error,
        },
      });
      if (result.count === 0) return false;
      await tx.deliveryAttempt.create({ data: { deliveryId, ...attempt } });
      return true;
    });
  },

  markFailed: (id, lastError, db = prisma) =>
    db.webhookDelivery.updateMany({
      where: { id, status: { in: ['PENDING', 'RETRYING'] } },
      data: { status: 'FAILED', nextAttemptAt: null, lastError },
    }),

  /** Manual redelivery is only allowed from a terminal state, so it can never race an in-flight retry. */
  async resetForRedelivery(id, runAt, db = prisma) {
    const result = await db.webhookDelivery.updateMany({
      where: { id, status: { in: ['SUCCEEDED', 'FAILED'] } },
      data: { status: 'PENDING', attemptCount: 0, nextAttemptAt: runAt, deliveredAt: null, lastError: null },
    });
    return result.count === 1;
  },

  /** Work that should already have run (lost job, crash between commit and enqueue). */
  findOverdue: (before, limit = 500, db = prisma) =>
    db.webhookDelivery.findMany({
      where: { status: { in: ['PENDING', 'RETRYING'] }, nextAttemptAt: { lt: before } },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
      select: { id: true, nextAttemptAt: true },
    }),
};
