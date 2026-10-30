import { Router } from 'express';
import { endpointController } from '../controllers/endpoint.controller.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { createEndpointSchema, idParamSchema, updateEndpointSchema } from '../validators/schemas.js';

export const endpointRoutes = Router();

endpointRoutes.post('/', validate({ body: createEndpointSchema }), asyncHandler(endpointController.create));
endpointRoutes.get('/', asyncHandler(endpointController.list));
endpointRoutes.get('/:id', validate({ params: idParamSchema }), asyncHandler(endpointController.get));
endpointRoutes.get('/:id/secret', validate({ params: idParamSchema }), asyncHandler(endpointController.revealSecret));
endpointRoutes.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateEndpointSchema }),
  asyncHandler(endpointController.update),
);
endpointRoutes.delete('/:id', validate({ params: idParamSchema }), asyncHandler(endpointController.remove));
