const API_KEY = import.meta.env.VITE_API_KEY ?? '';

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) return null;

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = json?.error?.details?.map((d) => `${d.path}: ${d.message}`).join('; ');
    const error = new Error([json?.error?.message ?? `Request failed (${response.status})`, detail].filter(Boolean).join(' - '));
    error.status = response.status;
    throw error;
  }
  return json;
}

export const api = {
  listEndpoints: () => request('/endpoints').then((r) => r.data),
  createEndpoint: (body) => request('/endpoints', { method: 'POST', body }).then((r) => r.data),
  updateEndpoint: (id, body) => request(`/endpoints/${id}`, { method: 'PATCH', body }).then((r) => r.data),
  deleteEndpoint: (id) => request(`/endpoints/${id}`, { method: 'DELETE' }),
  revealSecret: (id) => request(`/endpoints/${id}/secret`).then((r) => r.data.secret_key),

  listDeliveries: ({ status, limit }) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (status) params.set('status', status);
    return request(`/deliveries?${params}`).then((r) => r.data);
  },
  getDelivery: (id) => request(`/deliveries/${id}`).then((r) => r.data),
  redeliver: (id) => request(`/deliveries/${id}/redeliver`, { method: 'POST' }).then((r) => r.data),

  sendEvent: (body) => request('/events', { method: 'POST', body }).then((r) => r.data),
};
