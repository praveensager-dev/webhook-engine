import { prisma } from '../db/prisma.js';

export const endpointRepository = {
  create: (data, db = prisma) => db.endpoint.create({ data }),

  findById: (id, db = prisma) => db.endpoint.findUnique({ where: { id } }),

  list: (db = prisma) => db.endpoint.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),

  update: (id, data, db = prisma) => db.endpoint.update({ where: { id }, data }),

  /** Cascades to webhook_deliveries and delivery_attempts via FK ON DELETE CASCADE. */
  delete: (id, db = prisma) => db.endpoint.delete({ where: { id } }),

  /** Active endpoints subscribed to this event type (exact match or the "*" wildcard). Uses the GIN index. */
  findActiveForEventType: (eventType, db = prisma) =>
    db.endpoint.findMany({
      where: {
        isActive: true,
        OR: [{ eventTypes: { has: eventType } }, { eventTypes: { has: '*' } }],
      },
      select: { id: true },
    }),
};
