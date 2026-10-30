import { prisma } from '../db/prisma.js';

export const eventRepository = {
  create: (data, db = prisma) => db.event.create({ data }),

  findById: (id, db = prisma) => db.event.findUnique({ where: { id } }),

  findByIdempotencyKey: (idempotencyKey, db = prisma) =>
    db.event.findUnique({ where: { idempotencyKey } }),

  markDispatched: (id, db = prisma) =>
    db.event.update({ where: { id }, data: { status: 'DISPATCHED', dispatchedAt: new Date() } }),

  /** Events whose fan-out job was never enqueued (or was lost). Served by events_status_created_at_idx. */
  findStalePending: (olderThan, limit = 200, db = prisma) =>
    db.event.findMany({
      where: { status: 'PENDING', createdAt: { lt: olderThan } },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    }),
};
