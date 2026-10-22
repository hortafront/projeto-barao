import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../helpers/browserAliases.js';
import { seedProducts, IDS } from '../../helpers/fakeDb.js';

const { createCart, STORAGE_KEY, lineKey, lineId } = await import('../../../public/js/cart.js');

const makeStorage = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, map };
};
const menu = () => new Map(seedProducts().map((p) => [p.id, p]));
const pizza = (flavorIds, extra = {}) => ({ kind: 'pizza', flavorIds, addonIds: [], quantity: 1, notes: '', ...extra });

const combo = {
  id: 'combo-1', kind: 'combo', name: 'Combo Família', description: '', priceCents: 5990, imageUrl: null, available: true,
  slots: [
    { id: 's1', position: 0, label: 'Pizza', kind: 'pizza', productIds: [IDS.calabresa, IDS.frango, IDS.bacon] },
    { id: 's2', position: 1, label: 'Bebida', kind: 'drink', productIds: [IDS.coca1l, IDS.guarana1l] },
  ],
};
const withCombo = (c = combo, mutate = (p) => p) => {
  const map = new Map(seedProducts().map((p) => [p.id, mutate(p)]));
  if (c) map.set(c.id, c);
  return map;
};
const comboItem = (flavorIds = [IDS.calabresa], extra = {}) => ({
  kind: 'combo',
  comboId: 'combo-1',
  slots: [{ kind: 'pizza', flavorIds, addonIds: extra.addonIds ?? [] }, { kind: 'drink', productId: IDS.coca1l }],
  quantity: extra.quantity ?? 1,
  notes: extra.notes ?? '',
});

test('combo: key estável independente da ordem dos sabores e dos adicionais', () => {
  const a = comboItem([IDS.calabresa, IDS.frango], { addonIds: [IDS.bordaCatupiry, IDS.catupiryCima] });
  const b = comboItem([IDS.frango, IDS.calabresa], { addonIds: [IDS.catupiryCima, IDS.bordaCatupiry] });
  assert.equal(lineKey(a), lineKey(b));
  assert.equal(lineKey(comboItem()), `c:combo-1|p:${IDS.calabresa}|a:;d:${IDS.coca1l}`);
  const cart = createCart({ storage: makeStorage() });
  assert.deepEqual(cart.add(a), { ok: true });
  cart.add(b);
  assert.equal(cart.getItems().length, 1);
  assert.equal(cart.getItems()[0].quantity, 2);
});

test('combo: subtotal = (preço do combo + adicionais) x quantidade; unitCents e lineTotalCents', () => {
  const cart = createCart({ storage: makeStorage() });
  cart.add(comboItem([IDS.calabresa, IDS.frango], { addonIds: [IDS.bordaCatupiry], quantity: 2 }));
  cart.add(pizza([IDS.calabresa]));
  const map = withCombo();
  const [line] = cart.getItems();
  assert.equal(cart.unitCents(line, map), 5990 + 450);
  assert.equal(cart.lineTotalCents(line, map), (5990 + 450) * 2);
  assert.equal(cart.subtotalCents(map), (5990 + 450) * 2 + 3049);
});

test('combo: toOrderItems no formato do body (sem key, sem preço)', () => {
  const cart = createCart({ storage: makeStorage() });
  cart.add(comboItem([IDS.frango], { addonIds: [IDS.catupiryCima], quantity: 3, notes: 'sem gelo' }));
  assert.deepEqual(cart.toOrderItems(), [{
    kind: 'combo',
    comboId: 'combo-1',
    slots: [{ kind: 'pizza', flavorIds: [IDS.frango], addonIds: [IDS.catupiryCima] }, { kind: 'drink', productId: IDS.coca1l }],
    quantity: 3,
    notes: 'sem gelo',
  }]);
});

test('combo: describe e details', () => {
  const cart = createCart({ storage: makeStorage() });
  cart.add(comboItem([IDS.calabresa, IDS.frango], { addonIds: [IDS.bordaCatupiry] }));
  const [line] = cart.getItems();
  const map = withCombo();
  assert.equal(cart.describe(line, map), 'Combo Família');
  assert.deepEqual(cart.details(line, map), [
    'Pizza: Pizza meio a meio: Calabresa / Frango',
    '+ Borda Recheada com Catupiry',
    'Bebida: Coca-Cola 1 Litro',
  ]);
});

test('combo: rejeita formato inválido', () => {
  const cart = createCart({ storage: makeStorage() });
  assert.equal(cart.add({ ...comboItem(), slots: [] }).ok, false);
  assert.equal(cart.add({ ...comboItem(), comboId: '' }).ok, false);
  assert.equal(cart.add({ ...comboItem(), slots: [{ kind: 'drink' }] }).ok, false);
  assert.equal(cart.add({ ...comboItem(), quantity: 0 }).ok, false);
});

test('combo: reconcile remove combo ausente, vaga incompatível e produto não permitido', () => {
  const build = () => { const c = createCart({ storage: makeStorage() }); c.add(comboItem()); return c; };
  assert.deepEqual(build().reconcile(withCombo()), { removed: 0, unavailable: [] });
  assert.equal(build().reconcile(withCombo(null)).removed, 1);
  const fewer = { ...combo, slots: [combo.slots[0]] };
  assert.equal(build().reconcile(withCombo(fewer)).removed, 1);
  const swapped = { ...combo, slots: [combo.slots[1], combo.slots[0]] };
  assert.equal(build().reconcile(withCombo(swapped)).removed, 1);
  const noCalabresa = { ...combo, slots: [{ ...combo.slots[0], productIds: [IDS.frango] }, combo.slots[1]] };
  assert.equal(build().reconcile(withCombo(noCalabresa)).removed, 1);
  const noCoca = { ...combo, slots: [combo.slots[0], { ...combo.slots[1], productIds: [IDS.guarana1l] }] };
  assert.equal(build().reconcile(withCombo(noCoca)).removed, 1);
  const twoBordas = createCart({ storage: makeStorage() });
  twoBordas.add(comboItem([IDS.calabresa], { addonIds: [IDS.bordaCatupiry, IDS.bordaChocolate] }));
  assert.equal(twoBordas.reconcile(withCombo()).removed, 1);
});

test('combo: reconcile mantém esgotado como unavailable', () => {
  const cart = createCart({ storage: makeStorage() });
  cart.add(comboItem());
  const [line] = cart.getItems();
  const soldOutCombo = cart.reconcile(withCombo({ ...combo, available: false }));
  assert.deepEqual(soldOutCombo, { removed: 0, unavailable: [lineId(line)] });
  assert.equal(cart.isBlocked(withCombo({ ...combo, available: false })), true);
  const soldOutFlavor = cart.reconcile(withCombo(combo, (p) => (p.id === IDS.calabresa ? { ...p, available: false } : p)));
  assert.deepEqual(soldOutFlavor.unavailable, [lineId(line)]);
  assert.equal(cart.getItems().length, 1);
});

test('combo: linhas antigas de pizza e bebida continuam carregando iguais', () => {
  const legacy = {
    v: 1,
    items: [
      { key: `p:${IDS.calabresa}|a:${IDS.bordaCatupiry}`, kind: 'pizza', flavorIds: [IDS.calabresa], addonIds: [IDS.bordaCatupiry], quantity: 2, notes: 'x' },
      { key: `d:${IDS.coca1l}`, kind: 'drink', productId: IDS.coca1l, quantity: 1 },
    ],
  };
  const cart = createCart({ storage: makeStorage({ [STORAGE_KEY]: JSON.stringify(legacy) }) });
  assert.deepEqual(cart.getItems(), legacy.items);
  assert.deepEqual(cart.reconcile(withCombo(null)), { removed: 0, unavailable: [] });
  const [p] = cart.getItems();
  assert.deepEqual(cart.details(p, menu()), ['+ Borda Recheada com Catupiry']);
  assert.equal(cart.subtotalCents(menu()), (3049 + 450) * 2 + 1000);
});
