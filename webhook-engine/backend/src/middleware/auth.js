import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest();
const expected = sha256(env.API_KEY);

/** Accepts `X-API-Key: <key>` or `Authorization: Bearer <key>`. Hashing first makes the comparison constant-time. */
export function requireApiKey(req, _res, next) {
  const bearer = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  const provided = req.get('x-api-key') ?? bearer;
  if (!provided || !crypto.timingSafeEqual(sha256(provided), expected)) {
    return next(AppError.unauthorized());
  }
  return next();
}
