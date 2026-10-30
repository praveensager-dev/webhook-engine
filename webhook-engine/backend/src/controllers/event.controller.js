import { eventService } from '../services/event.service.js';
import { toEventDto } from './presenters.js';

export const eventController = {
  async create(req, res) {
    const { event_type, payload } = req.valid.body;
    const { event, replayed } = await eventService.ingest({
      eventType: event_type,
      payload,
      idempotencyKey: req.valid.headers?.['idempotency-key'],
    });
    res.status(202).json({ data: toEventDto(event), idempotent_replay: replayed });
  },
};
