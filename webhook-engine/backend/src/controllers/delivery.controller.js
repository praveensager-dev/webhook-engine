import { deliveryService } from '../services/delivery.service.js';
import { toDeliveryDto } from './presenters.js';

export const deliveryController = {
  async list(req, res) {
    const { endpoint_id, status, limit, cursor } = req.valid.query;
    const { items, nextCursor } = await deliveryService.list({ endpointId: endpoint_id, status, limit, cursor });
    res.json({ data: items.map(toDeliveryDto), next_cursor: nextCursor });
  },

  async get(req, res) {
    res.json({ data: toDeliveryDto(await deliveryService.get(req.valid.params.id)) });
  },

  async redeliver(req, res) {
    const delivery = await deliveryService.redeliver(req.valid.params.id);
    res.status(202).json({ data: toDeliveryDto(delivery) });
  },
};
