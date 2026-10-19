import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrderSchema, ordersQuerySchema } from '../../src/schemas/order.schema.js';
import { productCreateSchema, productUpdateSchema } from '../../src/schemas/product.schema.js';
import { hoursSchema, settingsSchema } from '../../src/schemas/hours.schema.js';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';
const CAT = '44444444-4444-4444-8444-444444444444';

const pizza = (over = {}) => ({ kind: 'pizza', flavorIds: [U1], addonIds: [], quantity: 1, ...over });
const address = (over = {}) => ({ street: 'Rua A', number: '10', district: 'Centro', ...over });
const order = (over = {}) => ({
  fulfillment: 'delivery',
  customer: { name: 'João', phone: '(85) 99999-9999' },
  payment: { method: 'pix' },
  address: address(),
  items: [pizza()],
  ...over,
});

function fails(schema, input, path) {
  const r = schema.safeParse(input);
  assert.equal(r.success, false, 'deveria falhar');
  if (path) {
    assert.ok(
      r.error.issues.some((i) => JSON.stringify(i.path) === JSON.stringify(path)),
      `path ${JSON.stringify(path)} esperado; obtido ${JSON.stringify(r.error.issues.map((i) => i.path))}`,
    );
  }
}
function ok(schema, input) {
  const r = schema.safeParse(input);
  assert.equal(r.success, true, r.success ? '' : JSON.stringify(r.error.issues));
  return r.data;
}

test('pedido: rejeições', () => {
  fails(createOrderSchema, order({ items: [] }), ['items']);
  fails(createOrderSchema, order({ items: Array.from({ length: 31 }, () => pizza()) }), ['items']);
  fails(createOrderSchema, order({ items: [pizza({ quantity: 21 })] }), ['items', 0, 'quantity']);
  fails(createOrderSchema, order({ items: [pizza({ quantity: 1.5 })] }), ['items', 0, 'quantity']);
  fails(createOrderSchema, order({ items: [pizza({ flavorIds: [U1, U2, U3] })] }), ['items', 0, 'flavorIds']);
  fails(createOrderSchema, order({ items: [pizza({ flavorIds: [U1, U1] })] }), ['items', 0, 'flavorIds']);
  fails(createOrderSchema, order({ items: [pizza({ addonIds: [U2, U2] })] }), ['items', 0, 'addonIds']);
  fails(createOrderSchema, order({ address: undefined }), ['address']);
  fails(createOrderSchema, order({ customer: { name: 'João', phone: '859999999' } }), ['customer', 'phone']);
  fails(createOrderSchema, order({ customer: { name: 'J', phone: '85999999999' } }), ['customer', 'name']);
  fails(createOrderSchema, order({ notes: 'x'.repeat(281) }), ['notes']);
  fails(createOrderSchema, order({ items: [pizza({ notes: 'x'.repeat(141) })] }), ['items', 0, 'notes']);
  fails(createOrderSchema, order({ address: address({ number: '12345678901' }) }), ['address', 'number']);
  fails(createOrderSchema, order({ payment: { method: 'boleto' } }), ['payment', 'method']);
  fails(createOrderSchema, order({ payment: { method: 'cash', changeForCents: -1 } }), ['payment', 'changeForCents']);
});

test('pedido: dados limpos', () => {
  assert.equal(ok(createOrderSchema, order()).customer.phone, '85999999999');
  const p = ok(createOrderSchema, order({ fulfillment: 'pickup', address: address() }));
  assert.equal(p.address, null);
  const s = ok(createOrderSchema, order({
    priceCents: 1,
    subtotalCents: 2,
    items: [pizza({ priceCents: 1, subtotalCents: 2 })],
  }));
  assert.ok(!('priceCents' in s) && !('subtotalCents' in s));
  assert.ok(!('priceCents' in s.items[0]) && !('subtotalCents' in s.items[0]));
  assert.equal(ok(createOrderSchema, order({ address: address({ reference: '' }) })).address.reference, null);
  assert.equal(ok(createOrderSchema, order({ notes: '' })).notes, null);
  assert.equal(
    ok(createOrderSchema, order({ customer: { name: 'João 🍕\uD83C', phone: '85999999999' } })).customer.name,
    'João 🍕�',
  );
  assert.equal(ok(createOrderSchema, order({ payment: { method: 'cash', changeForCents: 0 } })).payment.changeForCents, 0);
});

test('ordersQuerySchema', () => {
  assert.deepEqual(ok(ordersQuerySchema, {}), { page: 1 });
  fails(ordersQuerySchema, { from: '2026-02-31' }, ['from']);
  fails(ordersQuerySchema, { from: '2026-13-45' }, ['from']);
  fails(ordersQuerySchema, { to: '2026-00-10' }, ['to']);
  assert.equal(ok(ordersQuerySchema, { page: '2' }).page, 2);
  fails(ordersQuerySchema, { page: 0 }, ['page']);
});

const day = (weekday, over = {}) => ({ weekday, opensAt: '18:00', closesAt: '23:00', isClosed: false, ...over });
const week = () => [0, 1, 2, 3, 4, 5, 6].map((d) => day(d));

test('hoursSchema', () => {
  ok(hoursSchema, week());
  fails(hoursSchema, week().slice(0, 6));
  const rep = week();
  rep[6] = day(0);
  fails(hoursSchema, rep);
  const a = week();
  a[0] = day(0, { closesAt: '24:00' });
  fails(hoursSchema, a);
  const b = week();
  b[0] = day(0, { opensAt: '9:00' });
  fails(hoursSchema, b);
});

test('settingsSchema', () => {
  ok(settingsSchema, { storeOverride: 'open' });
  ok(settingsSchema, { whatsappNumber: '5585988887777' });
  for (const bad of [
    { whatsappNumber: '(85) 98888-7777' },
    { whatsappNumber: '85988887777' },
    { whatsappNumber: '55859888877' },
    { whatsappNumber: '55859888877771' },
    {},
    { storeOverride: 'x' },
  ]) {
    fails(settingsSchema, bad);
  }
});

const prod = (over = {}) => ({ categoryId: CAT, kind: 'pizza', name: 'Calabresa', priceCents: 3500, ...over });

test('productCreateSchema', () => {
  fails(productCreateSchema, prod({ addonGroup: 'borda' }), ['addonGroup']);
  ok(productCreateSchema, prod({ kind: 'addon', addonGroup: 'borda' }));
  const d = ok(productCreateSchema, prod());
  assert.equal(d.description, '');
  assert.equal(d.available, true);
  assert.equal(d.sortOrder, 0);
  assert.equal(d.addonGroup, null);
});

test('productUpdateSchema', () => {
  for (const k of ['name', 'priceCents', 'categoryId', 'kind']) {
    const p = prod();
    delete p[k];
    fails(productUpdateSchema, p, [k]);
  }
  const d = ok(productUpdateSchema, prod());
  for (const k of ['description', 'available', 'sortOrder']) assert.ok(!(k in d), k);
  assert.equal(d.addonGroup, null);
  fails(productUpdateSchema, prod({ addonGroup: 'borda' }), ['addonGroup']);
});
