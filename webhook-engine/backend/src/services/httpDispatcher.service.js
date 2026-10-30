import { Agent, fetch } from 'undici';
import { env } from '../config/env.js';
import { assertSafeTarget, guardedLookup } from '../utils/urlGuard.js';
import { buildSignatureHeader } from './signature.service.js';

// Shared keep-alive pool. `lookup` re-validates every resolved address at connect time (SSRF / DNS rebinding).
const agent = new Agent({
  connect: { lookup: guardedLookup, timeout: 5000 },
  keepAliveTimeout: 10_000,
});

const SNIPPET_BYTES = 1024;

async function readSnippet(response) {
  try {
    if (!response.body) return null;
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (size < SNIPPET_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    await reader.cancel().catch(() => {}); // never buffer an unbounded response from a third party
    return Buffer.concat(chunks).toString('utf8').slice(0, SNIPPET_BYTES);
  } catch {
    return null;
  }
}

/**
 * Performs one signed delivery attempt. Never throws: every outcome is returned as data so the
 * caller can persist it. Redirects are not followed (a 3xx counts as failure) to avoid redirect-based SSRF.
 */
export async function sendWebhook({ url, secret, body, headers = {} }) {
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);

  try {
    assertSafeTarget(url);
    const { header } = buildSignatureHeader(secret, body);

    const response = await fetch(url, {
      method: 'POST',
      body,
      redirect: 'manual',
      dispatcher: agent,
      signal: AbortSignal.timeout(env.WEBHOOK_TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        'user-agent': 'WebhookEngine/1.0',
        ...headers,
        'x-webhook-signature': header,
      },
    });

    const responseSnippet = await readSnippet(response);
    const ok = response.status >= 200 && response.status < 300;
    return {
      ok,
      statusCode: response.status,
      error: ok ? null : `Endpoint responded with HTTP ${response.status}`,
      responseSnippet,
      durationMs: elapsed(),
    };
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    const message = timedOut
      ? `Request timed out after ${env.WEBHOOK_TIMEOUT_MS}ms`
      : err?.cause?.message || err?.message || 'Unknown network error';
    return {
      ok: false,
      statusCode: null,
      error: String(message).slice(0, 500),
      responseSnippet: null,
      durationMs: elapsed(),
    };
  }
}
