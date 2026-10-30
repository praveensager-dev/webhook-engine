import { Router } from 'express';
import { deliveryRoutes } from './delivery.routes.js';
import { endpointRoutes } from './endpoint.routes.js';
import { eventRoutes } from './event.routes.js';

export const v1Router = Router();

v1Router.use('/events', eventRoutes);
v1Router.use('/endpoints', endpointRoutes);
v1Router.use('/deliveries', deliveryRoutes);
