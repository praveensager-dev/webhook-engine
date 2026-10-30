import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const build = (limit) =>
  rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) =>
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down', request_id: req.id },
      }),
  });

export const apiLimiter = build(env.RATE_LIMIT_PER_MINUTE);
export const ingestLimiter = build(env.INGEST_RATE_LIMIT_PER_MINUTE);
