import { env } from '../config/env.js';

/** Delay (seconds) applied after failed attempt N (index N-1). Default: 1m, 5m, 15m, 60m. */
export const RETRY_DELAYS_SECONDS = env.BACKOFF_SCHEDULE_SECONDS;

/** Initial attempt + one retry per schedule entry. Default: 5. */
export const MAX_ATTEMPTS = RETRY_DELAYS_SECONDS.length + 1;

/**
 * Returns the delay in ms before the next attempt, or `null` when attempts are exhausted.
 * Up to 10% positive jitter prevents synchronized retry storms when an endpoint recovers.
 */
export function computeRetryDelayMs(failedAttemptNumber, { jitterRatio = 0.1, random = Math.random } = {}) {
  if (failedAttemptNumber >= MAX_ATTEMPTS) return null;
  const baseMs = RETRY_DELAYS_SECONDS[failedAttemptNumber - 1] * 1000;
  return Math.round(baseMs + baseMs * jitterRatio * random());
}
