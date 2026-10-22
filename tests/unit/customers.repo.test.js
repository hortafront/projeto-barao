import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCustomersRepo } from '../../src/db/repositories/customers.repo.js';
import { createOrdersRepo } from '../../src/db/repositories/orders.repo.js';
import { toAddress } from '../../src/db/repositories/mappers.js';

const ROW = {
  id: 'a1', user_id: 'u', label: null, street: 'Rua A', number: '1', district: 'Centro', reference: null,
  is_default: true, created_at: '2026-10-18T23:00:00Z', updated_at: '2026-10-18T23:01:00Z',
};

/** Stub encadeável de supabase: grava chamadas; todo encadeamento é "thenable" e resolve com `result`. */
function stub(result = { data: null, error: null }) {
  const calls = [];
  // result pode ser { from, rpc } para respostas diferentes por origem da cadeia
  const pick = (root) => (result.from || result.rpc ? result[root] : result);
  const chain = (root) => new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return (res, rej) => Promise.resolve(pick(root)).then(res, rej);
      return (...args) => { calls.push([prop, ...args]); return chain(root); };
    },
  });
  const supabase = {
    from: (...a) => { calls.push(['from', ...a]); return chain('from'); },
    rpc: (...a) => { calls.push(['rpc', ...a]); return chain('rpc'); },
    auth: { admin: { deleteUser: async (...a) => { calls.push(['deleteUser', ...a]); return result; } } },
  };
  return { supabase, calls };
}
const has = (calls, ...c) => calls.some((x) => JSON.stringify(x) === JSON.stringify(c));

test('toAddress converte snake_case para camelCase', () => {
  assert.deepEqual(toAddress(ROW), {
    id: 'a1', label: null, street: 'Rua A', number: '1', district: 'Centro', reference: null,
    isDefault: true, createdAt: '2026-10-18T23:00:00Z', updatedAt: '2026-10-18T23:01:00Z',
  });
});

test('listAddresses filtra por user_id e ordena padrão primeiro, depois mais recente', async () => {
  const { supabase, calls } = stub({ data: [ROW], error: null });
  const list = await createCustomersRepo(supabase).listAddresses('u');
  assert.ok(has(calls, 'from', 'customer_addresses'));
  assert.ok(has(calls, 'eq', 'user_id', 'u'));
  assert.ok(has(calls, 'order', 'is_default', { ascending: false }));
  assert.ok(has(calls, 'order', 'created_at', { ascending: false }));
  assert.equal(list[0].isDefault, true);
});

test('getCustomer devolve { name, phone } ou null', async () => {
  let s = stub({ data: { name: 'João', phone: '85999999999' }, error: null });
  assert.deepEqual(await createCustomersRepo(s.supabase).getCustomer('u'), { name: 'João', phone: '85999999999' });
  s = stub({ data: null, error: null });
  assert.equal(await createCustomersRepo(s.supabase).getCustomer('u'), null);
});

test('upsertCustomer faz upsert por user_id', async () => {
  const { supabase, calls } = stub({ data: { name: 'João', phone: '85999999999' }, error: null });
  const r = await createCustomersRepo(supabase).upsertCustomer('u', { name: 'João', phone: '85999999999' });
  assert.ok(has(calls, 'upsert', { user_id: 'u', name: 'João', phone: '85999999999' }, { onConflict: 'user_id' }));
  assert.deepEqual(r, { name: 'João', phone: '85999999999' });
});

test('createAddress com isDefault true chama set_default_address e devolve a linha dela', async () => {
  const { supabase, calls } = stub({
    from: { data: { ...ROW, is_default: false }, error: null }, rpc: { data: [ROW], error: null } });
  const r = await createCustomersRepo(supabase).createAddress('u',
    { label: '', street: 'Rua A', number: '1', district: 'Centro', reference: '', isDefault: true });
  const insert = calls.find((c) => c[0] === 'insert');
  assert.deepEqual(insert[1], { user_id: 'u', label: null, street: 'Rua A', number: '1', district: 'Centro', reference: null });
  assert.ok(has(calls, 'rpc', 'set_default_address', { p_user_id: 'u', p_address_id: 'a1' }));
  assert.equal(r.id, 'a1');
});

test('createAddress sem isDefault não chama a rpc', async () => {
  const { supabase, calls } = stub({ data: { ...ROW, is_default: false }, error: null });
  const r = await createCustomersRepo(supabase).createAddress('u',
    { label: null, street: 'Rua A', number: '1', district: 'Centro', reference: null, isDefault: false });
  assert.equal(calls.some((c) => c[0] === 'rpc'), false);
  assert.equal(r.isDefault, false);
});

test('updateAddress filtra por id e user_id; linha inexistente → null', async () => {
  const { supabase, calls } = stub({ data: null, error: null });
  const r = await createCustomersRepo(supabase).updateAddress('u', 'a1',
    { label: null, street: 'Rua B', number: '2', district: 'Centro', reference: null, isDefault: true });
  assert.ok(has(calls, 'eq', 'id', 'a1'));
  assert.ok(has(calls, 'eq', 'user_id', 'u'));
  assert.equal(calls.some((c) => c[0] === 'rpc'), false);
  assert.equal(r, null);
});

test('setDefaultAddress chama a rpc; 0 linhas → null', async () => {
  let s = stub({ data: [], error: null });
  assert.equal(await createCustomersRepo(s.supabase).setDefaultAddress('u', 'a'), null);
  assert.ok(has(s.calls, 'rpc', 'set_default_address', { p_user_id: 'u', p_address_id: 'a' }));
  s = stub({ data: [ROW], error: null });
  assert.equal((await createCustomersRepo(s.supabase).setDefaultAddress('u', 'a1')).id, 'a1');
});

test('deleteAddress usa a rpc delete_customer_address e devolve o boolean', async () => {
  let s = stub({ data: true, error: null });
  assert.equal(await createCustomersRepo(s.supabase).deleteAddress('u', 'a'), true);
  assert.ok(has(s.calls, 'rpc', 'delete_customer_address', { p_user_id: 'u', p_address_id: 'a' }));
  s = stub({ data: false, error: null });
  assert.equal(await createCustomersRepo(s.supabase).deleteAddress('u', 'a'), false);
});

test('deleteCustomerAccount chama auth.admin.deleteUser; erro vira INTERNAL', async () => {
  let s = stub({ data: {}, error: null });
  await createCustomersRepo(s.supabase).deleteCustomerAccount('u');
  assert.ok(has(s.calls, 'deleteUser', 'u'));
  s = stub({ data: null, error: { message: 'boom' } });
  await assert.rejects(createCustomersRepo(s.supabase).deleteCustomerAccount('u'), (e) => e.code === 'INTERNAL');
});

test('orders.createOrder envia customer_id no payload da rpc (null quando anônimo)', async () => {
  const draft = {
    customer: { name: 'João', phone: '85999999999' }, fulfillment: 'pickup', address: null,
    payment: { method: 'pix' }, subtotalCents: 3049,
    items: [{ kind: 'pizza', description: 'Calabresa', productIds: ['p'], flavorNames: ['Calabresa'], addons: [],
      baseUnitCents: 3049, unitPriceCents: 3049, quantity: 1, lineTotalCents: 3049 }],
  };
  const run = async (extra) => {
    const { supabase, calls } = stub({ data: { id: 'o', code: 'BR-0001', created_at: 'x' }, error: null });
    await createOrdersRepo(supabase).createOrder({ ...draft, ...extra });
    return calls.find((c) => c[0] === 'rpc')[2].payload.customer_id;
  };
  assert.equal(await run({ customerId: 'u' }), 'u');
  assert.equal(await run({}), null);
});
