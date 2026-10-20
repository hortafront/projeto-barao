import { test } from 'node:test';
import assert from 'node:assert/strict';

const { createAdminApi, AdminApiError, withSaving } = await import('../../../public/admin/js/admin-api.js');

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup({ responses, tokens = ['t1'], refresh = async () => true }) {
  const calls = [];
  const logouts = [];
  let t = 0;
  const queue = [...responses];
  const api = createAdminApi({
    fetchImpl: async (path, init) => {
      calls.push({ path, init });
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    getAccessToken: async () => tokens[Math.min(t++, tokens.length - 1)],
    refreshSession: refresh,
    logout: (reason) => { logouts.push(reason); return new Promise(() => {}); },
  });
  return { api, calls, logouts };
}

test('GET 200 devolve dados com Authorization Bearer', async () => {
  const { api, calls } = setup({ responses: [json(200, { products: [] })] });
  assert.deepEqual(await api('/api/admin/products'), { products: [] });
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer t1');
});

test('corpo JSON envia Content-Type application/json', async () => {
  const { api, calls } = setup({ responses: [json(200, { ok: 1 })] });
  await api('/api/admin/hours', { method: 'PUT', body: { a: 1 } });
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].init.body, '{"a":1}');
});

test('204 devolve null', async () => {
  const { api } = setup({ responses: [new Response(null, { status: 204 })] });
  assert.equal(await api('/api/admin/products/1', { method: 'DELETE' }), null);
});

test('400 vira AdminApiError com code e details', async () => {
  const { api } = setup({ responses: [json(400, { error: { code: 'VALIDATION_ERROR', message: 'Dados inválidos', details: [{ path: 'name' }] } })] });
  await assert.rejects(api('/api/admin/products', { method: 'POST', body: {} }), (err) => {
    assert.ok(err instanceof AdminApiError);
    assert.equal(err.status, 400);
    assert.equal(err.code, 'VALIDATION_ERROR');
    assert.equal(err.message, 'Dados inválidos');
    assert.deepEqual(err.details, [{ path: 'name' }]);
    return true;
  });
});

test('falha de rede vira code NETWORK', async () => {
  const { api } = setup({ responses: [new TypeError('fetch failed')] });
  await assert.rejects(api('/api/admin/products'), (err) => err instanceof AdminApiError && err.code === 'NETWORK' && err.status === 0);
});

test('401 no upload: refresh e repete o mesmo FormData sem Content-Type', async () => {
  const form = new FormData();
  form.append('image', new Blob(['x'], { type: 'image/png' }), 'a.png');
  let refreshed = 0;
  const { api, calls } = setup({
    responses: [json(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }), json(200, { imageUrl: 'u' })],
    tokens: ['t1', 't2'],
    refresh: async () => { refreshed += 1; return true; },
  });
  const result = await api('/api/admin/products/1/image', { method: 'POST', body: form });
  assert.deepEqual(result, { imageUrl: 'u' });
  assert.equal(refreshed, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.body, form);
  assert.equal(calls[1].init.body, form);
  assert.equal('Content-Type' in calls[1].init.headers, false);
  assert.equal(calls[1].init.headers.Authorization, 'Bearer t2');
});

test('401 com refresh falho chama logout("sessao") e não repete', async () => {
  const { api, calls, logouts } = setup({
    responses: [json(401, {})],
    refresh: async () => false,
  });
  api('/api/admin/products');
  await tick();
  assert.deepEqual(logouts, ['sessao']);
  assert.equal(calls.length, 1);
});

test('401 de novo após refresh chama logout("sessao") uma vez', async () => {
  const { api, calls, logouts } = setup({ responses: [json(401, {}), json(401, {})], tokens: ['t1', 't2'] });
  api('/api/admin/products');
  await tick();
  assert.deepEqual(logouts, ['sessao']);
  assert.equal(calls.length, 2);
});

test('sem token chama logout("sessao") sem fazer fetch', async () => {
  const { api, calls, logouts } = setup({ responses: [], tokens: [null] });
  api('/api/admin/products');
  await tick();
  assert.deepEqual(logouts, ['sessao']);
  assert.equal(calls.length, 0);
});

test('403 chama logout("acesso")', async () => {
  const { api, logouts } = setup({ responses: [json(403, {})] });
  api('/api/admin/settings');
  await tick();
  assert.deepEqual(logouts, ['acesso']);
});

test('withSaving restaura texto e disabled do botão após erro', async () => {
  const button = {
    textContent: 'Salvar', disabled: false, attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
  };
  const toasts = [];
  let during;
  await assert.rejects(withSaving(button, async () => {
    during = { text: button.textContent, disabled: button.disabled };
    throw new Error('falhou');
  }, { toast: (m, k) => toasts.push([m, k]) }), /falhou/);
  assert.deepEqual(during, { text: 'Salvando…', disabled: true });
  assert.equal(button.textContent, 'Salvar');
  assert.equal(button.disabled, false);
  assert.deepEqual(button.attrs, {});
  assert.deepEqual(toasts, [['falhou', 'error']]);
});

test('withSaving em sucesso avisa Salvo e devolve o resultado', async () => {
  const button = { textContent: 'Salvar', disabled: false, setAttribute() {}, removeAttribute() {} };
  const toasts = [];
  const r = await withSaving(button, async () => 7, { toast: (m, k) => toasts.push([m, k]) });
  assert.equal(r, 7);
  assert.deepEqual(toasts, [['Salvo ✓', 'success']]);
});
