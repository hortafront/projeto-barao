import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import '../../helpers/browserAliases.js';

const { request, createOrder } = await import('../../../public/js/api.js');

const realFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = realFetch; });
afterEach(() => { globalThis.fetch = realFetch; });

const jsonResponse = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

test('201 com JSON devolve ok: true com status e data', async () => {
  globalThis.fetch = async () => jsonResponse(201, { code: 'BR-0001' });
  assert.deepEqual(await request('/api/orders'), { ok: true, status: 201, data: { code: 'BR-0001' } });
});

test('409 STORE_CLOSED devolve erro estruturado sem lançar', async () => {
  const error = { code: 'STORE_CLOSED', message: 'Loja fechada.', details: { nextOpenAt: 'x' } };
  globalThis.fetch = async () => jsonResponse(409, { error });
  assert.deepEqual(await request('/api/orders'), { ok: false, error: { status: 409, ...error } });
});

test('502 com HTML vira INTERNAL com mensagem genérica', async () => {
  globalThis.fetch = async () => new Response('<html>Bad Gateway</html>', { status: 502 });
  const res = await request('/api/menu');
  assert.equal(res.ok, false);
  assert.equal(res.error.status, 502);
  assert.equal(res.error.code, 'INTERNAL');
  assert.equal(res.error.message, 'Algo deu errado. Tente novamente.');
});

test('fetch rejeitando vira NETWORK', async () => {
  globalThis.fetch = async () => { throw new TypeError('failed'); };
  const res = await request('/api/menu');
  assert.equal(res.ok, false);
  assert.equal(res.error.status, 0);
  assert.equal(res.error.code, 'NETWORK');
  assert.equal(res.error.message, 'Sem conexão. Verifique sua internet e tente de novo.');
});

test('fetch que nunca resolve aborta no timeout e vira NETWORK', async () => {
  globalThis.fetch = (url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  const res = await request('/api/menu', { timeoutMs: 20 });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'NETWORK');
});

test('createOrder envia POST JSON com o payload', async () => {
  let seen;
  globalThis.fetch = async (url, init) => { seen = { url, init }; return jsonResponse(201, {}); };
  const payload = { customer: { name: 'Ana' }, items: [] };
  await createOrder(payload);
  assert.equal(seen.url, '/api/orders');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers['Content-Type'], 'application/json');
  assert.equal(seen.init.body, JSON.stringify(payload));
});
