import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireCustomer } from '../../src/middleware/requireCustomer.js';

const MSG = 'Entre na sua conta para continuar.';

function run(authorization, getUser) {
  const db = { getUserByAccessToken: async (t) => getUser(t) };
  const req = { get: (h) => (h.toLowerCase() === 'authorization' ? authorization : undefined) };
  return new Promise((resolve) => {
    requireCustomer({ db })(req, {}, (...args) => resolve({ args, req }));
  });
}

for (const [label, header] of [['sem header', undefined], ['Basic', 'Basic x']]) {
  test(`requireCustomer: ${label} -> 401`, async () => {
    const { args } = await run(header, async () => ({ id: '1', email: 'a@b.c' }));
    assert.equal(args[0].code, 'UNAUTHORIZED');
    assert.equal(args[0].status, 401);
    assert.equal(args[0].message, MSG);
  });
}

test('requireCustomer: token desconhecido -> 401', async () => {
  const { args } = await run('Bearer abc', async () => null);
  assert.equal(args[0].code, 'UNAUTHORIZED');
  assert.equal(args[0].status, 401);
  assert.equal(args[0].message, MSG);
});

test('requireCustomer: token válido põe req.customer', async () => {
  const { args, req } = await run('Bearer abc', async () => ({ id: 'u1', email: 'x@y.z', extra: 1 }));
  assert.equal(args.length, 0);
  assert.deepEqual(req.customer, { id: 'u1', email: 'x@y.z' });
});

test('requireCustomer: erro do Supabase propaga (não vira 401)', async () => {
  const boom = new Error('supabase fora');
  const { args } = await run('Bearer abc', async () => {
    throw boom;
  });
  assert.equal(args[0], boom);
});
