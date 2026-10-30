import crypto from 'node:crypto';

/** Per-endpoint signing secret. 256 bits of entropy, URL-safe. */
export function generateSecret() {
  return `whsec_${crypto.randomBytes(32).toString('base64url')}`;
}

/** HMAC-SHA256 over `${timestamp}.${rawBody}` - the timestamp is signed so it cannot be replayed with a new one. */
export function computeSignature(secret, timestamp, rawBody) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
}

/** Builds the `X-Webhook-Signature` header value: `t=<unix seconds>,v1=<hex hmac>`. */
export function buildSignatureHeader(secret, rawBody, timestamp = Math.floor(Date.now() / 1000)) {
  const v1 = computeSignature(secret, timestamp, rawBody);
  return { header: `t=${timestamp},v1=${v1}`, timestamp, signature: v1 };
}

/**
 * Reference verifier for webhook consumers (also used by scripts/demo-receiver.js).
 * Constant-time comparison + timestamp tolerance to reject replays.
 */
export function verifySignatureHeader({
  secret,
  rawBody,
  header,
  toleranceSeconds = 300,
  now = Math.floor(Date.now() / 1000),
}) {
  const parts = Object.fromEntries(
    String(header ?? '')
      .split(',')
      .map((part) => part.trim().split('='))
      .filter((pair) => pair.length === 2),
  );
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || !parts.v1) return false;
  if (Math.abs(now - timestamp) > toleranceSeconds) return false;

  const expected = Buffer.from(computeSignature(secret, timestamp, rawBody), 'hex');
  const received = Buffer.from(parts.v1, 'hex');
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}
