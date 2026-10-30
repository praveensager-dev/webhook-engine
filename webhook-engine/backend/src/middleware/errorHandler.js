import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { env, isProd } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError } from '../utils/AppError.js';

const DB_UNAVAILABLE_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024']);

function mapError(err) {
  if (err instanceof AppError) {
    return { status: err.statusCode, code: err.code, message: err.message, details: err.details };
  }

  if (err instanceof ZodError) {
    return {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    };
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return { status: 409, code: 'CONFLICT', message: 'A record with these values already exists' };
    if (err.code === 'P2025') return { status: 404, code: 'NOT_FOUND', message: 'Resource not found' };
    if (err.code === 'P2003') return { status: 409, code: 'CONSTRAINT_VIOLATION', message: 'Operation violates a data constraint' };
    if (DB_UNAVAILABLE_CODES.has(err.code)) {
      return { status: 503, code: 'DATABASE_UNAVAILABLE', message: 'Database is temporarily unavailable' };
    }
    return { status: 500, code: 'DATABASE_ERROR', message: 'Database error' };
  }
  if (err instanceof Prisma.PrismaClientInitializationError) {
    return { status: 503, code: 'DATABASE_UNAVAILABLE', message: 'Database is temporarily unavailable' };
  }

  // body-parser errors
  if (err?.type === 'entity.parse.failed') return { status: 400, code: 'INVALID_JSON', message: 'Request body is not valid JSON' };
  if (err?.type === 'entity.too.large') return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' };

  // Redis / queue connectivity
  if (/ECONNREFUSED|Connection is closed|enqueue\w* timed out|redis/i.test(`${err?.code ?? ''} ${err?.message ?? ''}`)) {
    return { status: 503, code: 'QUEUE_UNAVAILABLE', message: 'Queue is temporarily unavailable' };
  }

  return {
    status: 500,
    code: 'INTERNAL_ERROR',
    message: isProd ? 'Internal server error' : err?.message || 'Internal server error',
  };
}

// Express identifies error middleware by its 4-argument signature; keep `next` even though it is rarely used.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const mapped = mapError(err);
  const logPayload = { err, requestId: req.id, code: mapped.code, path: req.path };
  if (mapped.status >= 500) logger.error(logPayload, 'request failed');
  else logger.warn({ ...logPayload, err: err?.message }, 'request rejected');

  if (res.headersSent) return next(err);

  return res.status(mapped.status).json({
    error: {
      code: mapped.code,
      message: mapped.message,
      ...(mapped.details && { details: mapped.details }),
      request_id: req.id,
      ...(!isProd && env.NODE_ENV !== 'test' && mapped.status >= 500 && { stack: err?.stack }),
    },
  });
}
