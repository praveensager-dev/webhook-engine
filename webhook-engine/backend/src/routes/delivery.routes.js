import { Router } from 'express';
import { deliveryController } from '../controllers/delivery.controller.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { idParamSchema, listDeliveriesQuerySchema } from '../validators/schemas.js';

export const deliveryRoutes = Router();

deliveryRoutes.get('/', validate({ query: listDeliveriesQuerySchema }), asyncHandler(deliveryController.list));
deliveryRoutes.get('/:id', validate({ params: idParamSchema }), asyncHandler(deliveryController.get));
deliveryRoutes.post('/:id/redeliver', validate({ params: idParamSchema }), asyncHandler(deliveryController.redeliver));
