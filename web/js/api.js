// Обёртка над HTTP API сервера.

async function request(path, options) {
  const res = await fetch(path, options);
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error(`Сервер вернул не-JSON (${res.status})`);
  }
  if (!res.ok || (data && data.error)) {
    throw new Error((data && data.error) || `Ошибка ${res.status}`);
  }
  return data;
}

const post = (path, body = {}) => request(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  state: () => request('/api/state'),
  stats: () => request('/api/stats'),
  sync: (payload) => post('/api/sync', payload),
  buy: (id, hype) => post('/api/buy', { id, hype }),
  rollEvent: (cringe) => post('/api/roll-event', { cringe }),
  fixEvent: (id, hype) => post('/api/fix-event', { id, hype }),
  shop: (id) => post('/api/shop', { id }),
  skin: (id) => post('/api/skin', { id }),
  reset: () => post('/api/reset'),
};
