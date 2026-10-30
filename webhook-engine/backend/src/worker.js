import { Worker } from 'bullmq';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './db/prisma.js';
import { createRedisConnection } from './db/redis.js';
import { deliveryService } from './services/delivery.service.js';
import { eventService } from './services/event.service.js';
import { closeQueues, QUEUE_NAMES } from './services/queue.service.js';
import { startReconciler } from './services/reconciler.service.js';

// Each Worker gets its own blocking connection (BullMQ requirement).
const fanoutWorker = new Worker(QUEUE_NAMES.FANOUT, (job) => eventService.fanOut(job.data.eventId), {
  connection: createRedisConnection(),
  concurrency: 5,
});

const deliveryWorker = new Worker(QUEUE_NAMES.DELIVERY, (job) => deliveryService.processDelivery(job.data.deliveryId), {
  connection: createRedisConnection(),
  concurrency: env.WORKER_CONCURRENCY,
});

for (const worker of [fanoutWorker, deliveryWorker]) {
  worker.on('completed', (job, result) => logger.debug({ queue: worker.name, jobId: job.id, result }, 'job completed'));
  worker.on('failed', (job, err) =>
    logger.error({ queue: worker.name, jobId: job?.id, attemptsMade: job?.attemptsMade, err: err.message }, 'job failed'),
  );
  worker.on('error', (err) => logger.error({ queue: worker.name, err: err.message }, 'worker error'));
}

const reconciler = startReconciler();
logger.info({ concurrency: env.WORKER_CONCURRENCY }, 'worker started');

let shuttingDown = false;
async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'worker shutting down');
  setTimeout(() => process.exit(1), 30_000).unref();

  reconciler.stop();
  await Promise.allSettled([fanoutWorker.close(), deliveryWorker.close()]); // waits for in-flight jobs
  await closeQueues();
  await prisma.$disconnect();
  process.exit(exitCode);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'unhandled promise rejection'));
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception');
  shutdown('uncaughtException', 1);
});
