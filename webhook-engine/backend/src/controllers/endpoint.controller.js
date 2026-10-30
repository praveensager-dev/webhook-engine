import { endpointService } from '../services/endpoint.service.js';
import { toEndpointDto } from './presenters.js';

export const endpointController = {
  async create(req, res) {
    const endpoint = await endpointService.create(req.valid.body);
    // The full secret is returned on creation; the list view only ever shows a masked preview.
    res.status(201).json({ data: toEndpointDto(endpoint, { includeSecret: true }) });
  },

  async list(_req, res) {
    const endpoints = await endpointService.list();
    res.json({ data: endpoints.map((e) => toEndpointDto(e)) });
  },

  async get(req, res) {
    res.json({ data: toEndpointDto(await endpointService.get(req.valid.params.id)) });
  },

  async revealSecret(req, res) {
    const endpoint = await endpointService.get(req.valid.params.id);
    res.set('Cache-Control', 'no-store').json({ data: { id: endpoint.id, secret_key: endpoint.secretKey } });
  },

  async update(req, res) {
    const endpoint = await endpointService.update(req.valid.params.id, req.valid.body);
    res.json({ data: toEndpointDto(endpoint) });
  },

  async remove(req, res) {
    await endpointService.remove(req.valid.params.id);
    res.status(204).end();
  },
};
