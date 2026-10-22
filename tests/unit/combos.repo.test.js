import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCombosRepo } from '../../src/db/repositories/combos.repo.js';
import { createOrdersRepo } from '../../src/db/repositories/orders.repo.js';
import { toCombo, toOrder } from '../../src/db/repositories/mappers.js';

const ROW = {
  id: 'c1', name: 'Combo A', description: 'd', price_cents: 3690, image_url: null, weekdays: [4], available: true,
  created_at: '2026-10-22T10:00:00Z', updated_at: '2026-10-22T10:00:00Z',
  combo_slots: [
    { id: 's2', position: 1, label: 'Refri', kind: 'drink', product_ids: ['d1'] },
    { id: 's1', position: 0, label: 'Pizza', kind: 'pizza', product_ids: ['p1', 'p2'] },
  ],
};
const INPUT = {
  name: 'Combo A', description: 'd', priceCents: 3690, weekdays: [4],
  slots: [{ label: 'Pizza', kind: 'pizza', productIds: ['p1'] }, { label: 'Refri', kind: 'drink', productIds: ['d1'] }],
};

/** Stub encadeável (mesmo padrão de customers.repo.test.js); `result` por origem: { from, rpc, count }. */
function stub(result = { data: null, error: null }) {
  const calls = [];
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
    storage: { from: () => ({
      upload: async (...a) => { calls.push(['upload', ...a]); return { error: null }; },
      getPublicUrl: (p) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/product-images/${p}` } }),
      remove: async (...a) => { calls.push(['remove', ...a]); return { error: null }; },
    }) },
  };
  return { supabase, calls };
}
const has = (calls, ...c) => calls.some((x) => JSON.stringify(x) === JSON.stringify(c));

test('toCombo converte para camelCase e ordena vagas por position', () => {
  const c = toCombo(ROW);
  assert.deepEqual(c.slots.map((s) => s.position), [0, 1]);
  assert.deepEqual(c.slots[0], { id: 's1', position: 0, label: 'Pizza', kind: 'pizza', productIds: ['p1', 'p2'] });
  assert.equal(c.priceCents, 3690);
  assert.deepEqual(c.weekdays, [4]);
  assert.equal(c.imageUrl, null);
  assert.equal(c.createdAt, '2026-10-22T10:00:00Z');
});

test('createCombo chama rpc save_combo com p_id null e payload snake_case, e relê o combo', async () => {
  const { supabase, calls } = stub({ rpc: { data: 'c1', error: null }, from: { data: ROW, error: null } });
  const c = await createCombosRepo(supabase).createCombo(INPUT);
  assert.ok(has(calls, 'rpc', 'save_combo', { p_id: null, payload: {
    name: 'Combo A', description: 'd', price_cents: 3690, weekdays: [4],
    slots: [{ label: 'Pizza', kind: 'pizza', product_ids: ['p1'] }, { label: 'Refri', kind: 'drink', product_ids: ['d1'] }],
  } }));
  assert.ok(has(calls, 'from', 'combos'));
  assert.ok(has(calls, 'eq', 'id', 'c1'));
  assert.equal(c.id, 'c1');
});

test('updateCombo passa p_id; combo inexistente (releitura vazia) -> null', async () => {
  let s = stub({ rpc: { data: 'c1', error: null }, from: { data: ROW, error: null } });
  await createCombosRepo(s.supabase).updateCombo('c1', INPUT);
  assert.ok(s.calls.some((c) => c[0] === 'rpc' && c[2].p_id === 'c1'));
  s = stub({ rpc: { data: null, error: null }, from: { data: null, error: null } });
  assert.equal(await createCombosRepo(s.supabase).updateCombo('c1', INPUT), null);
  assert.equal(s.calls.some((c) => c[0] === 'rpc'), false);
  s = stub({ rpc: { data: null, error: { message: 'boom', code: 'XX' } }, from: { data: ROW, error: null } });
  await assert.rejects(createCombosRepo(s.supabase).updateCombo('c1', INPUT), (e) => e.code === 'INTERNAL');
});

test('getTodayCombo filtra por weekdays contendo o dia, ordena por created_at, limita 1', async () => {
  const { supabase, calls } = stub({ data: [ROW], error: null });
  const c = await createCombosRepo(supabase).getTodayCombo(4);
  assert.ok(has(calls, 'contains', 'weekdays', [4]));
  assert.ok(has(calls, 'order', 'created_at', { ascending: true }));
  assert.equal(c.id, 'c1');
  assert.equal(await createCombosRepo(stub({ data: [], error: null }).supabase).getTodayCombo(2), null);
});

test('getCombo / getCombosByIds / listCombos', async () => {
  let s = stub({ data: ROW, error: null });
  assert.equal((await createCombosRepo(s.supabase).getCombo('c1')).id, 'c1');
  s = stub({ data: null, error: null });
  assert.equal(await createCombosRepo(s.supabase).getCombo('c1'), null);
  s = stub({ data: [ROW], error: null });
  assert.equal((await createCombosRepo(s.supabase).getCombosByIds(['c1'])).length, 1);
  assert.ok(has(s.calls, 'in', 'id', ['c1']));
  s = stub({ data: [ROW], error: null });
  assert.equal((await createCombosRepo(s.supabase).listCombos()).length, 1);
});

test('deleteCombo conta order_items por combo_id e lança PRODUCT_HAS_ORDERS', async () => {
  const { supabase, calls } = stub({ data: [], count: 2, error: null });
  await assert.rejects(createCombosRepo(supabase).deleteCombo('c1'), (e) => e.code === 'PRODUCT_HAS_ORDERS'
    && e.status === 409 && e.message === 'Combo já tem pedidos; marque como esgotado em vez de excluir');
  assert.ok(has(calls, 'from', 'order_items'));
  assert.ok(has(calls, 'eq', 'combo_id', 'c1'));
});

test('deleteCombo sem pedidos apaga e remove a imagem; inexistente -> false', async () => {
  const url = 'https://x.supabase.co/storage/v1/object/public/product-images/combos/c1-1.webp';
  let s = stub({ data: [{ id: 'c1', image_url: url }], count: 0, error: null });
  assert.equal(await createCombosRepo(s.supabase).deleteCombo('c1'), true);
  assert.ok(has(s.calls, 'remove', ['combos/c1-1.webp']));
  s = stub({ data: [], count: 0, error: null });
  assert.equal(await createCombosRepo(s.supabase).deleteCombo('c1'), false);
});

test('setComboAvailability atualiza available', async () => {
  const { supabase, calls } = stub({ data: ROW, error: null });
  const c = await createCombosRepo(supabase).setComboAvailability('c1', false);
  assert.ok(has(calls, 'update', { available: false }));
  assert.equal(c.id, 'c1');
});

test('uploadComboImage grava em combos/<id>-<ts>.<ext> e atualiza image_url', async () => {
  const { supabase, calls } = stub({ data: ROW, error: null });
  await createCombosRepo(supabase).uploadComboImage('c1', { buffer: Buffer.from('x'), contentType: 'image/png' });
  const up = calls.find((c) => c[0] === 'upload');
  assert.match(up[1], /^combos\/c1-\d+\.png$/);
  const upd = calls.find((c) => c[0] === 'update');
  assert.match(upd[1].image_url, /product-images\/combos\/c1-\d+\.png$/);
});

test('toOrder expõe comboId/choices (null em item que não é combo)', () => {
  const base = { id: 'i', description: 'd', product_ids: [], flavor_names: null, addons: [], base_unit_cents: 1,
    unit_price_cents: 1, quantity: 1, notes: null, line_total_cents: 1 };
  const o = toOrder({
    id: 'o1', code: 'BR-0001', status: 'received', created_at: 'x', customer_name: 'A', customer_phone: '85999999999',
    fulfillment: 'pickup', payment_method: 'pix', change_for_cents: null, notes: null, subtotal_cents: 2,
    order_items: [{ ...base, kind: 'combo', combo_id: 'c1', combo_choices: [{ label: 'Pizza' }] }, { ...base, kind: 'pizza' }],
  });
  assert.equal(o.items[0].comboId, 'c1');
  assert.deepEqual(o.items[0].choices, [{ label: 'Pizza' }]);
  assert.equal(o.items[1].comboId, null);
  assert.equal(o.items[1].choices, null);
});

test('createOrder grava combo_id e combo_choices no payload da rpc', async () => {
  const { supabase, calls } = stub({ data: { id: 'o', code: 'BR-0001', created_at: 'x' }, error: null });
  const item = { kind: 'combo', comboId: 'c1', choices: [{ label: 'Pizza' }], description: 'Combo', productIds: ['p'],
    flavorNames: null, addons: [], baseUnitCents: 1, unitPriceCents: 1, quantity: 1, lineTotalCents: 1 };
  await createOrdersRepo(supabase).createOrder({
    customer: { name: 'A', phone: '85999999999' }, fulfillment: 'pickup', payment: { method: 'pix' }, subtotalCents: 2,
    items: [item, { ...item, kind: 'drink', comboId: undefined, choices: undefined }],
  });
  const { payload } = calls.find((c) => c[0] === 'rpc')[2];
  assert.equal(payload.items[0].combo_id, 'c1');
  assert.deepEqual(payload.items[0].combo_choices, [{ label: 'Pizza' }]);
  assert.equal(payload.items[1].combo_id, null);
  assert.equal(payload.items[1].combo_choices, null);
});
