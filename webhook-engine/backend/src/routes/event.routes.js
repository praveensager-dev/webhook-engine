import { Router } from 'express';
import { eventController } from '../controllers/event.controller.js';
import { ingestLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { createEventSchema, ingestHeadersSchema } from '../validators/schemas.js';

export const eventRoutes = Router();

eventRoutes.post(
  '/',
  ingestLimiter,
  validate({ body: createEventSchema, headers: ingestHeadersSchema }),
  asyncHandler(eventController.create),
);
