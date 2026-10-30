import { endpointRepository } from '../repositories/endpoint.repository.js';
import { AppError } from '../utils/AppError.js';
import { assertSafeTarget } from '../utils/urlGuard.js';
import { generateSecret } from './signature.service.js';

export const endpointService = {
  async create({ url, description, event_types }) {
    assertSafeTarget(url);
    return endpointRepository.create({
      url,
      description,
      eventTypes: event_types,
      secretKey: generateSecret(),
    });
  },

  list: () => endpointRepository.list(),

  async get(id) {
    const endpoint = await endpointRepository.findById(id);
    if (!endpoint) throw AppError.notFound('Endpoint not found');
    return endpoint;
  },

  async update(id, { url, description, event_types, is_active }) {
    if (url !== undefined) assertSafeTarget(url);
    return endpointRepository.update(id, {
      ...(url !== undefined && { url }),
      ...(description !== undefined && { description }),
      ...(event_types !== undefined && { eventTypes: event_types }),
      ...(is_active !== undefined && { isActive: is_active }),
    });
  },

  async remove(id) {
    await endpointRepository.delete(id); // P2025 -> 404 in the global error handler
  },
};
