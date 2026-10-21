import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb, IDS } from '../helpers/fakeDb.js';
import { fixedNow, SUNDAY_20H } from '../helpers/clock.js';

const U = '00000000-0000-4000-8000-0000000000a1';
const V = '00000000-0000-4000-8000-0000000000b1';
const addr = (street, extra = {}) => ({ label: null, street, number: '1', district: 'Centro', reference: null, isDefault: false, ...extra });
const mk = () => createFakeDb({ now: fixedNow(SUNDAY_20H), customers: { [U]: { name: 'João Silva', phone: '85999999999' } } });
const draft = (extra = {}) => ({
  customer: { name: 'João Silva', phone: '85999999999' }, fulfillment: 'pickup', address: null,
  payment: { method: 'pix' }, subtotalCents: 3049,
  items: [{ kind: 'pizza', description: 'Calabresa', productIds: [IDS.calabresa], flavorNames: ['Calabresa'], addons: [],
    baseUnitCents: 3049, unitPriceCents: 3049, quantity: 1, lineTotalCents: 3049 }],
  ...extra,
});

test('upsertCustomer cria e atualiza; getCustomer de outro id é null', async () => {
  const db = createFakeDb({ now: fixedNow(SUNDAY_20H) });
  assert.equal(await db.getCustomer(U), null);
  assert.deepEqual(await db.upsertCustomer(U, { name: 'João', phone: '85999999999' }), { name: 'João', phone: '85999999999' });
  await db.upsertCustomer(U, { name: 'João S', phone: '85988887777' });
  assert.deepEqual(await db.getCustomer(U), { name: 'João S', phone: '85988887777' });
  assert.equal(await db.getCustomer(V), null);
});

test('createAddress sem perfil lança; primeiro com isDefault false não vira padrão', async () => {
  const db = mk();
  await assert.rejects(db.createAddress(V, addr('Rua A')), /FK/);
  const a = await db.createAddress(U, addr('Rua A'));
  assert.equal(a.isDefault, false);
  assert.equal(a.label, null);
  assert.equal('_seq' in a, false);
});

test('dois padrões: só o último; listAddresses ordena padrão, depois mais recente', async () => {
  const db = mk();
  const a = await db.createAddress(U, addr('A', { isDefault: true }));
  const b = await db.createAddress(U, addr('B'));
  const c = await db.createAddress(U, addr('C', { isDefault: true }));
  assert.deepEqual((await db.listAddresses(U)).map((x) => x.id), [c.id, b.id, a.id]);
  assert.deepEqual((await db.listAddresses(U)).map((x) => x.isDefault), [true, false, false]);
});

test('updateAddress: isDefault false não muda o padrão; true troca', async () => {
  const db = mk();
  const a = await db.createAddress(U, addr('A', { isDefault: true }));
  const b = await db.createAddress(U, addr('B'));
  const r = await db.updateAddress(U, a.id, addr('A2', { isDefault: false }));
  assert.equal(r.street, 'A2');
  assert.equal(r.isDefault, true);
  await db.updateAddress(U, b.id, addr('B', { isDefault: true }));
  assert.deepEqual((await db.listAddresses(U)).map((x) => x.id), [b.id, a.id]);
  assert.equal(await db.updateAddress(V, a.id, addr('X')), null);
});

test('deleteAddress: padrão promove o mais recente; último esvazia; outro cliente false', async () => {
  const db = mk();
  const a = await db.createAddress(U, addr('A'));
  const b = await db.createAddress(U, addr('B'));
  const c = await db.createAddress(U, addr('C', { isDefault: true }));
  assert.equal(await db.deleteAddress(V, c.id), false);
  assert.equal((await db.listAddresses(U)).length, 3);
  assert.equal(await db.deleteAddress(U, c.id), true);
  const list = await db.listAddresses(U);
  assert.deepEqual(list.map((x) => [x.id, x.isDefault]), [[b.id, true], [a.id, false]]);
  await db.deleteAddress(U, b.id);
  await db.deleteAddress(U, a.id);
  assert.deepEqual(await db.listAddresses(U), []);
});

test('setDefaultAddress de endereço alheio devolve null sem mudar nada', async () => {
  const db = mk();
  await db.upsertCustomer(V, { name: 'Bia Costa', phone: '85988887777' });
  const a = await db.createAddress(U, addr('A', { isDefault: true }));
  const b = await db.createAddress(U, addr('B'));
  assert.equal(await db.setDefaultAddress(V, a.id), null);
  assert.equal((await db.listAddresses(U))[0].id, a.id);
  assert.equal((await db.setDefaultAddress(U, b.id)).isDefault, true);
  assert.equal((await db.listAddresses(U))[0].id, b.id);
});

test('deleteCustomerAccount apaga perfil, endereços e usuários; pedidos ficam sem cliente', async () => {
  const db = createFakeDb({ now: fixedNow(SUNDAY_20H), customers: { [U]: { name: 'João Silva', phone: '85999999999' } },
    users: { tok: { id: U, email: 'j@x.com' }, tok2: { id: V, email: 'b@x.com' } } });
  await db.createAddress(U, addr('A'));
  await db.createOrder(draft({ customerId: U }));
  assert.equal(db.state.orders[0].customerId, U);
  await db.deleteCustomerAccount(U);
  assert.equal(await db.getCustomer(U), null);
  assert.deepEqual(await db.listAddresses(U), []);
  assert.equal(await db.getUserByAccessToken('tok'), null);
  assert.notEqual(await db.getUserByAccessToken('tok2'), null);
  assert.equal(db.state.orders[0].customerId, null);
});

test('createOrder com customerId sem perfil lança', async () => {
  const db = mk();
  await assert.rejects(db.createOrder(draft({ customerId: V })), /customer_id sem perfil/);
  await db.createOrder(draft());
  assert.equal(db.state.orders[0].customerId, null);
});
