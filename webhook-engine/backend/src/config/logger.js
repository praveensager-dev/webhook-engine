import pino from 'pino';
import { env, isProd } from './env.js';

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : isProd ? 'info' : 'debug',
  redact: {
    paths: ['req.headers.authorization', 'req.headers["x-api-key"]', '*.secret_key', '*.secretKey'],
    censor: '[redacted]',
  },
});
