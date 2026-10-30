import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

export const prisma = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

/** Run `fn` inside an interactive transaction. All writes in `fn` commit or roll back together. */
export const withTransaction = (fn, options = {}) =>
  prisma.$transaction(fn, { maxWait: 5000, timeout: 15000, ...options });
