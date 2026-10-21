import { test } from 'node:test';
import assert from 'node:assert/strict';

const { createCustomerApi, authErrorMessage, passwordError, CUSTOMER_STORAGE_KEY, SESSION_LOST } =
  await import('../../../public/js/customer-api.js');

const ok = (status = 200, data = {}) => ({ ok: true, status, data });
const fail = (status, code = 'X') => ({ ok: false, error: { status, code, message: 'm' } });

function setup({ results, tokens = ['t1', 't2'], refresh = async () => true }) {
  const calls = [];
  const lost = [];
  let t = 0;
  const queue = [...results];
  const api = createCustomerApi({
    request: async (path, opts) => { calls.push({ path, opts }); return queue.shift(); },
    getAccessToken: async () => tokens[Math.min(t++, tokens.length - 1)],
    refreshSession: refresh,
    onSessionLost: () => lost.push(1),
  });
  return { api, calls, lost };
}

test('sem token: não chama request, avisa onSessionLost 1x e devolve SESSION_LOST', async () => {
  const { api, calls, lost } = setup({ results: [], tokens: [null] });
  const res = await api.customerApi('/api/me');
  assert.deepEqual(res, { ok: false, error: SESSION_LOST });
  assert.equal(calls.length, 0);
  assert.equal(lost.length, 1);
});

test('200 usa o token e devolve o resultado', async () => {
  const { api, calls } = setup({ results: [ok()] });
  const res = await api.customerApi('/api/me', { method: 'PUT' });
  assert.equal(res.ok, true);
  assert.equal(calls[0].opts.token, 't1');
  assert.equal(calls[0].opts.method, 'PUT');
});

test('401 -> refresh -> repete uma vez com token novo', async () => {
  const { api, calls, lost } = setup({ results: [fail(401), ok()] });
  const res = await api.customerApi('/api/me');
  assert.equal(res.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].opts.token, 't2');
  assert.equal(lost.length, 0);
});

test('refresh false ou rejeitado -> onSessionLost 1x', async () => {
  for (const refresh of [async () => false, async () => { throw new Error('x'); }]) {
    const { api, calls, lost } = setup({ results: [fail(401)], refresh });
    const res = await api.customerApi('/api/me');
    assert.equal(res.ok, false);
    assert.equal(calls.length, 1);
    assert.equal(lost.length, 1);
  }
});

test('401 de novo após refresh -> onSessionLost 1x, no máximo 2 chamadas', async () => {
  const { api, calls, lost } = setup({ results: [fail(401), fail(401), ok()] });
  const res = await api.customerApi('/api/me');
  assert.equal(res.ok, false);
  assert.equal(calls.length, 2);
  assert.equal(lost.length, 1);
});

test('400, 409 e NETWORK passam direto, sem refresh', async () => {
  for (const r of [fail(400), fail(409), fail(0, 'NETWORK')]) {
    let refreshed = 0;
    const { api, calls, lost } = setup({ results: [r], refresh: async () => { refreshed++; return true; } });
    assert.deepEqual(await api.customerApi('/api/me'), r);
    assert.equal(calls.length, 1);
    assert.equal(refreshed, 0);
    assert.equal(lost.length, 0);
  }
});

test('withAuth repete a chamada com o token novo', async () => {
  const { api, lost } = setup({ results: [] });
  const tokens = [];
  const res = await api.withAuth(async (t) => { tokens.push(t); return tokens.length === 1 ? fail(401) : ok(); });
  assert.equal(res.ok, true);
  assert.deepEqual(tokens, ['t1', 't2']);
  assert.equal(lost.length, 0);
});

test('authErrorMessage traduz erros do Supabase', () => {
  assert.equal(authErrorMessage({ code: 'invalid_credentials' }), 'E-mail ou senha incorretos.');
  assert.equal(authErrorMessage({ code: 'user_already_exists' }), 'Já existe uma conta com esse e-mail. Quer entrar?');
  assert.equal(authErrorMessage({ message: 'User already registered' }), 'Já existe uma conta com esse e-mail. Quer entrar?');
  assert.equal(authErrorMessage({ code: 'weak_password' }), 'A senha precisa ter pelo menos 8 caracteres.');
  assert.equal(authErrorMessage({ name: 'AuthRetryableFetchError' }), 'Sem conexão. Verifique sua internet e tente de novo.');
  assert.equal(authErrorMessage({ status: 0 }), 'Sem conexão. Verifique sua internet e tente de novo.');
  assert.equal(authErrorMessage({ status: 429 }), 'Muitas tentativas. Aguarde alguns minutos e tente de novo.');
  assert.equal(authErrorMessage({ message: 'boom' }), 'Algo deu errado. Tente novamente.');
  assert.equal(authErrorMessage(null), 'Algo deu errado. Tente novamente.');
});

test('passwordError valida tamanho e confirmação', () => {
  assert.equal(passwordError('1234567'), 'A senha precisa ter pelo menos 8 caracteres.');
  assert.equal(passwordError('12345678', 'x'), 'As senhas não conferem.');
  assert.equal(passwordError('12345678', '12345678'), null);
  assert.equal(passwordError('12345678'), null);
});

test('CUSTOMER_STORAGE_KEY é distinta da do admin', () => {
  assert.equal(CUSTOMER_STORAGE_KEY, 'barao-cliente-auth');
  assert.notEqual(CUSTOMER_STORAGE_KEY, 'barao-admin-auth');
});
