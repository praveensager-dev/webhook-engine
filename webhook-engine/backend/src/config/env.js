import 'dotenv/config';
import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  API_KEY: z.string().min(16, 'API_KEY must be at least 16 characters'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  INGEST_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(1200),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(200).default(20),
  RECONCILE_INTERVAL_MS: z.coerce.number().int().min(1000).default(30000),
  BACKOFF_SCHEDULE_SECONDS: z
    .string()
    .default('60,300,900,3600')
    .transform((v) => v.split(',').map((s) => Number(s.trim())))
    .pipe(z.array(z.number().int().positive()).min(1).max(10)),
  ALLOW_PRIVATE_TARGETS: booleanString,
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    JSON.stringify({
      level: 'fatal',
      msg: 'Invalid environment configuration',
      issues: parsed.error.flatten().fieldErrors,
    }),
  );
  process.exit(1);
}

export const env = Object.freeze(parsed.data);
export const isProd = env.NODE_ENV === 'production';
