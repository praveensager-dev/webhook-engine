/**
 * Local webhook consumer for demos. Verifies the signature exactly as a real customer would, and
 * fails the first FAIL_UNTIL_ATTEMPT-1 attempts so you can watch exponential backoff in the dashboard.
 *
 *   SECRET=whsec_... FAIL_UNTIL_ATTEMPT=3 PORT=4000 npm run demo:receiver
 */
import http from 'node:http';
import { verifySignatureHeader } from '../src/services/signature.service.js';

const port = Number(process.env.PORT ?? 4000);
const secret = process.env.SECRET;
const failUntilAttempt = Number(process.env.FAIL_UNTIL_ATTEMPT ?? 1);

if (!secret) {
  console.error('Set SECRET to the endpoint secret shown in the dashboard.');
  process.exit(1);
}

http
  .createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const valid = verifySignatureHeader({ secret, rawBody, header: req.headers['x-webhook-signature'] });
      const attempt = Number(req.headers['x-webhook-attempt'] ?? 1);

      if (!valid) {
        console.log(`[attempt ${attempt}] 401 invalid signature`);
        res.writeHead(401).end('invalid signature');
        return;
      }
      if (attempt < failUntilAttempt) {
        console.log(`[attempt ${attempt}] 500 simulated failure`);
        res.writeHead(500).end('simulated failure');
        return;
      }
      console.log(`[attempt ${attempt}] 200 verified event ${req.headers['x-webhook-id']}: ${rawBody}`);
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"received":true}');
    });
  })
  .listen(port, () => console.log(`Demo receiver on http://localhost:${port}`));
