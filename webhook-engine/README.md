# Webhook Provider Engine (PERN)

Developers register endpoints, your system emits events, and this engine delivers them as signed webhooks
with exponential-backoff retries, a full audit trail, and a live dashboard.

```
                       POST /api/v1/events
  Client ───────────────────────────────────► Express API ──► Postgres (events, outbox = PENDING)
                         202 Accepted              │
                                                   └─ enqueue (not awaited) ─► Redis / BullMQ
                                                                                   │
        ┌──────────────────────────────────────────────────────────────────────────┘
        ▼
  Worker process
   ├─ fan-out job : tx{ find subscribed endpoints → INSERT deliveries → event=DISPATCHED } → enqueue deliveries
   ├─ delivery job: sign (HMAC-SHA256) → POST → record attempt → SUCCEEDED | RETRYING(+delay) | FAILED
   └─ reconciler  : re-enqueues anything Postgres says is overdue (Redis loss, crash between commit and enqueue)
```

## Layout

```
backend/src
  routes/         HTTP routing + middleware wiring
  controllers/    parse validated input, call a service, shape the response (snake_case DTOs)
  services/       business logic: signature, backoff, queue, dispatcher, event/endpoint/delivery, reconciler
  repositories/   all Prisma queries and transactions
  middleware/     auth, validation (Zod), rate limits, request id, global error handler
  app.js          security middleware + wiring      server.js  API process      worker.js  queue consumers
backend/prisma    schema.prisma + SQL migration
frontend/         Vite + React dashboard
```

## Run it

```bash
docker compose up -d                       # Postgres 16 + Redis 7 (AOF, noeviction)

cd backend
cp .env.example .env                       # set API_KEY (>= 16 chars)
npm install
npx prisma migrate deploy                  # applies prisma/migrations/*_init
npm run dev                                # API on :3000
npm run dev:worker                         # in a second terminal

cd ../frontend
cp .env.example .env                       # VITE_API_KEY must equal the backend API_KEY
npm install && npm run dev                 # dashboard on :5173
```

Try the retry flow locally (the receiver verifies signatures like a real customer and fails the first 2 attempts):

```bash
# backend/.env: ALLOW_PRIVATE_TARGETS=true  BACKOFF_SCHEDULE_SECONDS=5,10,15,20   (restart API + worker)
SECRET=<secret shown in dashboard> FAIL_UNTIL_ATTEMPT=3 npm run demo:receiver
# add http://localhost:4000 in the dashboard, click "Send test event", watch the attempt track fill
```

## API (all under `/api/v1`, header `X-API-Key`)

| Method | Path | Notes |
|---|---|---|
| POST | `/events` | `{ "event_type": "order.created", "payload": {...} }` → **202**. Optional `Idempotency-Key` header. |
| POST/GET | `/endpoints` | Create returns the secret once; list returns a masked preview. |
| GET | `/endpoints/:id/secret` | Reveal secret (`Cache-Control: no-store`). |
| PATCH/DELETE | `/endpoints/:id` | Pause/resume, edit, delete (cascades to deliveries + attempts). |
| GET | `/deliveries` | Filters `endpoint_id`, `status`; cursor pagination (`limit`, `cursor`). |
| GET | `/deliveries/:id` | Includes per-attempt log. |
| POST | `/deliveries/:id/redeliver` | **202**. Only from SUCCEEDED/FAILED; otherwise 409. |
| GET | `/healthz`, `/readyz` | Liveness / dependency readiness (no auth). |

Errors always look like `{ "error": { "code", "message", "details?", "request_id" } }`.

## What the receiver gets

Headers: `X-Webhook-Signature: t=<unix>,v1=<hex>`, `X-Webhook-Id` (event id), `X-Webhook-Delivery-Id`, `X-Webhook-Attempt`.
Body: `{ "id", "type", "created_at", "data": <your payload> }`.
Signature = `HMAC_SHA256(secret, "<t>." + <raw body>)`; the exact bytes sent are the bytes signed.

```js
import { verifySignatureHeader } from './signature.service.js'; // or reimplement: ~10 lines
const ok = verifySignatureHeader({ secret, rawBody, header: req.headers['x-webhook-signature'] });
```

## Design decisions worth calling out

- **Postgres is the source of truth, Redis is a transport.** The event row is the outbox. If Redis is down, ingestion
  still returns 202 and the reconciler recovers. Deterministic BullMQ job IDs make re-enqueueing idempotent.
- **Retries are persisted, not hidden in the queue.** Business retries use explicit delays (1m → 5m → 15m → 60m, max 5
  attempts, +≤10% jitter) stored in `webhook_deliveries.next_attempt_at`. BullMQ's own `attempts` only covers infra errors.
- **At-least-once delivery.** Optimistic locking on `attempt_count` stops duplicate jobs from double-recording; receivers
  should dedupe on `X-Webhook-Id`.
- **SSRF guard.** Destination URLs are validated, and the HTTP agent re-checks every resolved IP at connect time
  (defeats DNS rebinding). Redirects are not followed. Production requires https.
- **Indexes match the queries:** GIN on `endpoints.event_types` (fan-out), `(status, next_attempt_at)` (reconciler),
  `(endpoint_id, created_at)` and `(created_at)` (dashboard), unique `(event_id, endpoint_id)` (fan-out idempotency).

## Known limits / next hardening steps

- Secrets are stored in plaintext because HMAC needs them; encrypt at rest (AES-GCM + KMS) for real deployments.
- Single-tenant, shared API key. Add accounts and scope `endpoints`/`events` by `tenant_id` for multi-tenancy.
- The dashboard's `VITE_API_KEY` ships in the bundle: fine for a demo, replace with user auth in production.
- Manual re-delivery resets the attempt counter; earlier attempts stay in `delivery_attempts`.
- No automated tests are included yet; `backoff.service.js` and `signature.service.js` are pure and easy to unit test first.
