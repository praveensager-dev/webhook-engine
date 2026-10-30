import { z } from 'zod';
import { isProd } from '../config/env.js';

const uuid = z.string().uuid();
const eventType = z
  .string()
  .min(1)
  .max(100)
  .regex(/^(\*|[a-zA-Z0-9_.:-]+)$/, 'Use letters, digits, ". _ : -" or "*"');

const destinationUrl = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    const { protocol } = new URL(value);
    return isProd ? protocol === 'https:' : ['http:', 'https:'].includes(protocol);
  }, isProd ? 'URL must use https' : 'URL must use http or https');

export const idParamSchema = z.object({ id: uuid });

export const createEventSchema = z
  .object({
    event_type: eventType.refine((v) => v !== '*', 'event_type cannot be a wildcard'),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export const ingestHeadersSchema = z
  .object({ 'idempotency-key': z.string().min(1).max(255).optional() })
  .passthrough();

export const createEndpointSchema = z
  .object({
    url: destinationUrl,
    description: z.string().trim().max(200).optional(),
    event_types: z.array(eventType).min(1).max(50).default(['*']),
  })
  .strict();

export const updateEndpointSchema = z
  .object({
    url: destinationUrl.optional(),
    description: z.string().trim().max(200).nullable().optional(),
    event_types: z.array(eventType).min(1).max(50).optional(),
    is_active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

export const listDeliveriesQuerySchema = z.object({
  endpoint_id: uuid.optional(),
  status: z.enum(['PENDING', 'RETRYING', 'SUCCEEDED', 'FAILED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: uuid.optional(),
});
