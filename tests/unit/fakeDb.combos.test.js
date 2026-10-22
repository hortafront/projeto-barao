import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb, IDS } from '../helpers/fakeDb.js';
import { seedCombo } from '../helpers/testkit.js';
import { fixedNow, SUNDAY_20H } from '../helpers/clock.js';

const mk = () => createFakeDb({ now: fixedNow(SUNDAY_20H) });
const input = (extra = {}) => ({
  name: 'Combo A', description: 'desc', priceCents: 3690, weekdays: [4],
  slots: [
    { label: 'Escolha sua pizza', kind: 'pizza', productIds: [IDS.calabresa, IDS.mista] },
    { label: 'Escolha o refrigerante', kind: 'drink', productIds: [IDS.coca1l] },
  ],
  ...extra,
});
const comboDraft = (comboId) => ({
  customer: { name: 'João Silva', phone: '85999999999' }, fulfillment: 'pickup', address: null,
  payment: { method: 'pix' }, subtotalCents: 3690,
  items: [{ kind: 'combo', comboId, description: 'Combo A', productIds: [IDS.calabresa, IDS.coca1l],
    choices: [{ label: 'Pizza', kind: 'pizza', description: 'Calabresa', addons: [] }],
    flavorNames: null, addons: [], baseUnitCents: 3690, unitPriceCents: 3690, quantity: 1, lineTotalCents: 3690 }],
});

test('createCombo devolve combo com vagas por position, available true e imageUrl null', async () => {
  const db = mk();
  const c = await db.createCombo(input());
  assert.equal(c.available, true);
  assert.equal(c.imageUrl, null);
  assert.deepEqual(c.slots.map((s) => s.position), [0, 1]);
  assert.ok(c.slots.every((s) => s.id));
  assert.deepEqual(await db.getCombo(c.id), c);
  assert.deepEqual((await db.listCombos()).map((x) => x.id), [c.id]);
});

test('updateCombo substitui as vagas; id inexistente -> null', async () => {
  const db = mk();
  const c = await db.createCombo(input());
  const u = await db.updateCombo(c.id, input({ name: 'Novo', slots: [{ label: 'Só pizza', kind: 'pizza', productIds: [IDS.mista] }] }));
  assert.equal(u.name, 'Novo');
  assert.equal(u.slots.length, 1);
  assert.equal(u.slots[0].label, 'Só pizza');
  assert.equal(await db.updateCombo('nao-existe', input()), null);
});

test('getTodayCombo acha pelo dia (inclui esgotado) e getCombosByIds filtra', async () => {
  const db = mk();
  const c = await db.createCombo(input());
  await db.setComboAvailability(c.id, false);
  assert.equal((await db.getTodayCombo(4)).id, c.id);
  assert.equal((await db.getTodayCombo(4)).available, false);
  assert.equal(await db.getTodayCombo(2), null);
  assert.deepEqual((await db.getCombosByIds([c.id, 'x'])).map((x) => x.id), [c.id]);
});

test('seedCombo cria Combo Clássico na quinta com vagas pizza e drink', async () => {
  const db = mk();
  const c = await seedCombo(db);
  assert.equal(c.name, 'Combo Clássico');
  assert.equal(c.priceCents, 3690);
  assert.deepEqual(c.weekdays, [4]);
  assert.deepEqual([...c.slots[0].productIds].sort(), [IDS.mista, IDS.calabresa, IDS.mussarela, IDS.marguerita].sort());
  assert.deepEqual(c.slots[1].productIds, [IDS.coca1l, IDS.coca1lZero]);
  assert.equal((await seedCombo(db, { name: 'Outro', weekdays: [5] })).name, 'Outro');
});

test('uploadComboImage grava imageUrl em combos/', async () => {
  const db = mk();
  const c = await db.createCombo(input());
  const u = await db.uploadComboImage(c.id, { buffer: Buffer.from('x'), contentType: 'image/webp' });
  assert.match(u.imageUrl, /product-images\/combos\/.+\.webp$/);
  assert.equal(await db.uploadComboImage('x', { contentType: 'image/webp' }), null);
});

test('createOrder guarda comboId/choices; deleteCombo de combo pedido -> 409; sem pedido -> true/false', async () => {
  const db = mk();
  const c = await db.createCombo(input());
  const other = await db.createCombo(input({ name: 'Outro' }));
  await db.createOrder(comboDraft(c.id));
  const o = db.state.orders[0];
  assert.equal(o.items[0].comboId, c.id);
  assert.equal(o.items[0].choices[0].label, 'Pizza');
  await assert.rejects(db.deleteCombo(c.id), (e) => e.code === 'PRODUCT_HAS_ORDERS' && e.status === 409
    && e.message === 'Combo já tem pedidos; marque como esgotado em vez de excluir');
  assert.equal(await db.deleteCombo(other.id), true);
  assert.equal(await db.deleteCombo(other.id), false);
});

test('item que não é combo tem comboId/choices null', async () => {
  const db = mk();
  await db.createOrder({ ...comboDraft('x'), items: [{ kind: 'drink', description: 'Coca', productIds: [IDS.coca1l], flavorNames: null,
    addons: [], baseUnitCents: 1000, unitPriceCents: 1000, quantity: 1, lineTotalCents: 1000 }], subtotalCents: 1000 });
  assert.equal(db.state.orders[0].items[0].comboId, null);
  assert.equal(db.state.orders[0].items[0].choices, null);
});
