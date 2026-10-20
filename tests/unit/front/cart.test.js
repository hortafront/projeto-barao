import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../helpers/browserAliases.js';
import { seedProducts, IDS } from '../../helpers/fakeDb.js';

const { createCart, STORAGE_KEY, MAX_LINES, MAX_QTY, lineKey, lineId } = await import('../../../public/js/cart.js');

const makeStorage = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, map };
};
const indexById = (products) => new Map(products.map((p) => [p.id, p]));
const menu = () => indexById(seedProducts());
const pizza = (flavorIds, extra = {}) => ({ kind: 'pizza', flavorIds, addonIds: [], quantity: 1, notes: '', ...extra });

test('persiste no formato { v: 1, items } sem preço nem nome', () => {
  const storage = makeStorage();
  const cart = createCart({ storage });
  cart.add(pizza([IDS.calabresa], { addonIds: [IDS.bordaCatupiry], notes: 'sem cebola' }));
  cart.add({ kind: 'drink', productId: IDS.coca1l, quantity: 2 });
  const saved = JSON.parse(storage.map.get(STORAGE_KEY));
  assert.equal(STORAGE_KEY, 'barao:cart:v1');
  assert.deepEqual(saved, {
    v: 1,
    items: [
      { key: `p:${IDS.calabresa}|a:${IDS.bordaCatupiry}`, kind: 'pizza', flavorIds: [IDS.calabresa], addonIds: [IDS.bordaCatupiry], quantity: 1, notes: 'sem cebola' },
      { key: `d:${IDS.coca1l}`, kind: 'drink', productId: IDS.coca1l, quantity: 2 },
    ],
  });
});

test('mesma pizza soma quantidade com teto 20; ordem dos sabores não importa; obs. separa linhas', () => {
  const cart = createCart({ storage: makeStorage() });
  cart.add(pizza([IDS.frango, IDS.calabresa], { quantity: 15 }));
  cart.add(pizza([IDS.calabresa, IDS.frango], { quantity: 15 }));
  assert.equal(cart.getItems().length, 1);
  assert.equal(cart.getItems()[0].quantity, MAX_QTY);
  assert.equal(lineKey(pizza([IDS.frango, IDS.calabresa])), lineKey(pizza([IDS.calabresa, IDS.frango])));
  cart.add(pizza([IDS.frango, IDS.calabresa], { notes: 'bem assada' }));
  assert.equal(cart.getItems().length, 2);
  assert.equal(cart.count(), 21);
  const [a, b] = cart.getItems();
  assert.notEqual(lineId(a), lineId(b));
  assert.equal(lineId(b), `${b.key}|n:bem assada`);
});

test('31ª linha devolve CART_FULL', () => {
  const cart = createCart({ storage: makeStorage() });
  for (let i = 0; i < MAX_LINES; i += 1) assert.deepEqual(cart.add(pizza([IDS.mista], { notes: `n${i}` })), { ok: true });
  assert.deepEqual(cart.add(pizza([IDS.mista], { notes: 'extra' })), { ok: false, reason: 'CART_FULL' });
  assert.equal(cart.getItems().length, MAX_LINES);
});

test('subtotal: Calabresa/Frango + borda e 2 Coca 1L Zero = 5949', () => {
  const cart = createCart({ storage: makeStorage() });
  cart.add(pizza([IDS.calabresa, IDS.frango], { addonIds: [IDS.bordaCatupiry] }));
  cart.add({ kind: 'drink', productId: IDS.coca1lZero, quantity: 2 });
  assert.equal(cart.subtotalCents(menu()), 5949);
});

test('toOrderItems sem key, no formato do body de POST /api/orders', () => {
  const cart = createCart({ storage: makeStorage() });
  cart.add(pizza([IDS.calabresa], { notes: 'x' }));
  cart.add({ kind: 'drink', productId: IDS.coca600, quantity: 3 });
  assert.deepEqual(cart.toOrderItems(), [
    { kind: 'pizza', flavorIds: [IDS.calabresa], addonIds: [], quantity: 1, notes: 'x' },
    { kind: 'drink', productId: IDS.coca600, quantity: 3 },
  ]);
});

test('setQuantity, remove, clear e subscribe', () => {
  const cart = createCart({ storage: makeStorage() });
  let calls = 0;
  const off = cart.subscribe(() => { calls += 1; });
  cart.add(pizza([IDS.mista]));
  const id = lineId(cart.getItems()[0]);
  cart.setQuantity(id, 5);
  assert.equal(cart.count(), 5);
  cart.setQuantity(id, 99);
  assert.equal(cart.count(), MAX_QTY);
  cart.setQuantity(id, 0);
  assert.equal(cart.getItems().length, 0);
  cart.add(pizza([IDS.mista]));
  cart.clear();
  assert.equal(cart.count(), 0);
  off();
  const before = calls;
  cart.add(pizza([IDS.mista]));
  assert.equal(calls, before);
});

test('reconcile: carrinho salvo antes de mudanças no cardápio', () => {
  const removedId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const items = [
    pizza([removedId]),
    pizza([IDS.bacon]),
    pizza([IDS.frango]),
  ].map((i) => ({ key: lineKey(i), ...i }));
  const storage = makeStorage({ [STORAGE_KEY]: JSON.stringify({ v: 1, items }) });
  const products = seedProducts();
  products.find((p) => p.id === IDS.bacon).available = false;
  products.find((p) => p.id === IDS.frango).priceCents = 3999;
  const byId = indexById(products);

  const cart = createCart({ storage });
  const baconLineId = lineId(items[1]);
  assert.deepEqual(cart.reconcile(byId), { removed: 1, unavailable: [baconLineId] });
  assert.equal(cart.getItems().length, 2);
  assert.equal(cart.isBlocked(byId), true);
  const frango = cart.getItems().find((l) => l.flavorIds[0] === IDS.frango);
  assert.equal(cart.lineTotalCents(frango, byId), 3999);
  cart.remove(baconLineId);
  assert.equal(cart.isBlocked(byId), false);
  assert.equal(JSON.parse(storage.map.get(STORAGE_KEY)).items.length, 1);
});

test('reconcile remove kind errado, estrutura inválida e duas bordas', () => {
  const bad = [
    { kind: 'pizza', flavorIds: [IDS.coca1l], addonIds: [], quantity: 1, notes: '' },
    { kind: 'pizza', flavorIds: [IDS.calabresa], addonIds: [IDS.bordaCatupiry, IDS.bordaChocolate], quantity: 1, notes: '' },
    { kind: 'pizza', flavorIds: [IDS.calabresa, IDS.calabresa], addonIds: [], quantity: 1, notes: '' },
    { kind: 'drink', productId: IDS.mista, quantity: 1 },
    { kind: 'pizza', flavorIds: 'x', quantity: 1 },
    { kind: 'drink', productId: IDS.coca1l, quantity: 0 },
  ].map((i) => ({ key: 'k', ...i }));
  const good = { key: `d:${IDS.coca1l}`, kind: 'drink', productId: IDS.coca1l, quantity: 1 };
  const storage = makeStorage({ [STORAGE_KEY]: JSON.stringify({ v: 1, items: [...bad, good, null, 7] }) });
  const cart = createCart({ storage });
  const res = cart.reconcile(menu());
  assert.equal(res.removed, 6);
  assert.deepEqual(res.unavailable, []);
  assert.equal(cart.getItems().length, 1);
});

test('describe nomeia a linha pelo cardápio', () => {
  const cart = createCart({ storage: makeStorage() });
  cart.add(pizza([IDS.calabresa, IDS.frango], { addonIds: [IDS.bordaCatupiry] }));
  cart.add({ kind: 'drink', productId: IDS.coca1l, quantity: 1 });
  const [p, d] = cart.getItems();
  assert.match(cart.describe(p, menu()), /Calabresa/);
  assert.match(cart.describe(p, menu()), /Frango/);
  assert.match(cart.describe(d, menu()), /Coca-Cola 1 Litro/);
});

test('add rejeita bebida sem productId e trunca observação em 140', () => {
  const cart = createCart({ storage: makeStorage() });
  assert.deepEqual(cart.add({ kind: 'drink', quantity: 1 }), { ok: false, reason: 'INVALID_ITEM' });
  assert.deepEqual(cart.add({ kind: 'pizza', quantity: 1 }), { ok: false, reason: 'INVALID_ITEM' });
  assert.equal(cart.getItems().length, 0);
  cart.add(pizza([IDS.mista], { notes: 'x'.repeat(500) }));
  assert.equal(cart.getItems()[0].notes.length, 140);
});

test('preço com produto ausente do cardápio não lança: 0 / ignorado no subtotal', () => {
  const ghost = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const storage = makeStorage({ [STORAGE_KEY]: JSON.stringify({ v: 1, items: [
    { kind: 'pizza', flavorIds: [ghost], addonIds: [], quantity: 1, notes: '' },
    { kind: 'drink', productId: IDS.coca1l, quantity: 2 },
  ] }) });
  const cart = createCart({ storage });
  const byId = menu();
  const [bad, good] = cart.getItems();
  assert.equal(cart.lineTotalCents(bad, byId), 0);
  assert.equal(cart.unitCents(bad, byId), 0);
  assert.equal(cart.lineTotalCents(good, byId), 2000);
  assert.equal(cart.subtotalCents(byId), 2000);
});

test('add rejeita pizza com estrutura que o servidor recusaria', () => {
  const cart = createCart({ storage: makeStorage() });
  const invalid = { ok: false, reason: 'INVALID_ITEM' };
  assert.deepEqual(cart.add(pizza([IDS.mista, IDS.calabresa, IDS.frango])), invalid);
  assert.deepEqual(cart.add(pizza([])), invalid);
  assert.deepEqual(cart.add(pizza([IDS.mista, IDS.mista])), invalid);
  assert.deepEqual(cart.add(pizza([IDS.mista], { addonIds: [IDS.catupiryCima, IDS.catupiryCima] })), invalid);
  assert.deepEqual(cart.add(pizza([IDS.mista], { addonIds: Array.from({ length: 11 }, (_, i) => `a${i}`) })), invalid);
  assert.equal(cart.getItems().length, 0);
  assert.deepEqual(cart.add(pizza([IDS.mista, IDS.frango], { addonIds: [IDS.catupiryCima] })), { ok: true });
});

test('setQuantity ignora valor não inteiro', () => {
  const cart = createCart({ storage: makeStorage() });
  cart.add(pizza([IDS.mista]));
  const id = lineId(cart.getItems()[0]);
  for (const q of [NaN, 1.5, '3', undefined]) cart.setQuantity(id, q);
  assert.equal(cart.count(), 1);
});

test('storage corrompido, versão errada ou setItem que lança não quebram', () => {
  for (const raw of ['{', JSON.stringify({ v: 2, items: [{ key: 'x', kind: 'drink', productId: IDS.coca1l, quantity: 1 }] })]) {
    const cart = createCart({ storage: makeStorage({ [STORAGE_KEY]: raw }) });
    assert.deepEqual(cart.getItems(), []);
  }
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } };
  const cart = createCart({ storage: throwing });
  assert.deepEqual(cart.add(pizza([IDS.mista])), { ok: true });
  assert.equal(cart.count(), 1);
  assert.equal(createCart({ storage: null }).count(), 0);
});
