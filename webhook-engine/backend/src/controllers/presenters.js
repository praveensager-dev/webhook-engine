import { MAX_ATTEMPTS } from '../services/backoff.service.js';

const maskSecret = (secret) => `${secret.slice(0, 10)}…${secret.slice(-4)}`;

/** Public API contract is snake_case; Prisma models are camelCase. These are the only mapping points. */
export const toEndpointDto = (e, { includeSecret = false } = {}) => ({
  id: e.id,
  url: e.url,
  description: e.description,
  event_types: e.eventTypes,
  is_active: e.isActive,
  created_at: e.createdAt,
  updated_at: e.updatedAt,
  ...(includeSecret ? { secret_key: e.secretKey } : { secret_key_preview: maskSecret(e.secretKey) }),
});

export const toEventDto = (e) => ({
  id: e.id,
  event_type: e.eventType,
  status: e.status,
  created_at: e.createdAt,
});

export const toAttemptDto = (a) => ({
  id: a.id,
  attempt_number: a.attemptNumber,
  success: a.success,
  status_code: a.statusCode,
  error: a.error,
  response_snippet: a.responseSnippet,
  duration_ms: a.durationMs,
  created_at: a.createdAt,
});

export const toDeliveryDto = (d) => ({
  id: d.id,
  event_id: d.eventId,
  endpoint_id: d.endpointId,
  event_type: d.event?.eventType,
  endpoint_url: d.endpoint?.url,
  status: d.status,
  attempt_count: d.attemptCount,
  max_attempts: MAX_ATTEMPTS,
  last_status_code: d.lastStatusCode,
  last_error: d.lastError,
  next_attempt_at: d.nextAttemptAt,
  delivered_at: d.deliveredAt,
  created_at: d.createdAt,
  updated_at: d.updatedAt,
  ...(d.attempts && { attempts: d.attempts.map(toAttemptDto) }),
});
