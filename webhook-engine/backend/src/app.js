import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './db/prisma.js';
import { requireApiKey } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { requestId } from './middleware/requestId.js';
import { v1Router } from './routes/index.js';
import { pingQueue } from './services/queue.service.js';
import { AppError } from './utils/AppError.js';
import { asyncHandler } from './utils/asyncHandler.js';

const allowedOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);

export const app = express();

app.set('trust proxy', env.TRUST_PROXY_HOPS);
app.use(requestId);
app.use(pinoHttp({ logger, genReqId: (req) => req.id, autoLogging: { ignore: (req) => req.url.startsWith('/healthz') } }));
app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new AppError(403, 'CORS_FORBIDDEN', 'Origin not allowed'));
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization', 'Idempotency-Key'],
    maxAge: 600,
  }),
);
app.use(express.json({ limit: '256kb' }));

// Liveness: process is up. Readiness: dependencies are reachable.
app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
app.get(
  '/readyz',
  asyncHandler(async (_req, res) => {
    const [db, queue] = await Promise.allSettled([prisma.$queryRaw`SELECT 1`, pingQueue()]);
    const checks = { database: db.status === 'fulfilled', queue: queue.status === 'fulfilled' };
    res.status(checks.database && checks.queue ? 200 : 503).json({ status: checks.database && checks.queue ? 'ready' : 'unavailable', checks });
  }),
);

// Rate limit before auth so key-guessing is throttled too.
app.use('/api/v1', apiLimiter, requireApiKey, v1Router);

app.use(notFound);
app.use(errorHandler);
