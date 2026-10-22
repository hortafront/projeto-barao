import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../helpers/browserAliases.js';

const { todayInFortaleza, presetRange, formatTimeFortaleza, STATUS_LABEL, mergeOrderPages, itemDetailLines } =
  await import('../../../public/admin/js/orders.js');

const SUNDAY_20H = new Date('2026-10-18T23:00:00Z'); // domingo 20:00 em Fortaleza

test('todayInFortaleza usa o dia local, não o UTC', () => {
  assert.equal(todayInFortaleza(new Date('2026-10-19T01:30:00Z')), '2026-10-18');
  assert.equal(todayInFortaleza(new Date('2026-10-19T03:00:00Z')), '2026-10-19');
});

test('presetRange: hoje, ontem, 7 dias e mês', () => {
  assert.deepEqual(presetRange('hoje', SUNDAY_20H), { from: '2026-10-18', to: '2026-10-18' });
  assert.deepEqual(presetRange('ontem', SUNDAY_20H), { from: '2026-10-17', to: '2026-10-17' });
  assert.deepEqual(presetRange('7dias', SUNDAY_20H), { from: '2026-10-12', to: '2026-10-18' });
  assert.deepEqual(presetRange('mes', SUNDAY_20H), { from: '2026-10-01', to: '2026-10-18' });
});

test('presetRange atravessa virada de mês e ano', () => {
  const jan1 = new Date('2026-01-01T12:00:00Z');
  assert.deepEqual(presetRange('ontem', jan1), { from: '2025-12-31', to: '2025-12-31' });
  assert.deepEqual(presetRange('7dias', jan1), { from: '2025-12-26', to: '2026-01-01' });
});

test('formatTimeFortaleza converte UTC para HH:MM local', () => {
  assert.equal(formatTimeFortaleza('2026-10-19T01:00:00Z'), '22:00');
  assert.equal(formatTimeFortaleza('2026-10-19T12:05:00Z'), '09:05');
});

test('STATUS_LABEL', () => {
  assert.deepEqual(STATUS_LABEL, { received: 'Recebido', confirmed: 'Confirmado', canceled: 'Cancelado' });
});

test('mergeOrderPages: caso comum anexa tudo na ordem', () => {
  const { list, added } = mergeOrderPages([{ id: 'a' }, { id: 'b' }], [{ id: 'c' }, { id: 'd' }]);
  assert.deepEqual(list.map((o) => o.id), ['a', 'b', 'c', 'd']);
  assert.equal(added, 2);
});

test('mergeOrderPages: ignora pedido já listado (deslocamento por pedido novo)', () => {
  const { list, added } = mergeOrderPages([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]);
  assert.deepEqual(list.map((o) => o.id), ['a', 'b', 'c']);
  assert.equal(added, 1);
});

test('mergeOrderPages: duplicado dentro da própria página também é ignorado', () => {
  const { list, added } = mergeOrderPages([], [{ id: 'a' }, { id: 'a' }]);
  assert.equal(list.length, 1);
  assert.equal(added, 1);
});

test('itemDetailLines: pizza comum mantém sabores e adicionais', () => {
  const lines = itemDetailLines({
    kind: 'pizza', quantity: 1, description: 'Pizza', flavorNames: ['A', 'B'],
    addons: [{ name: 'Catupiry por cima', priceCents: 800 }], notes: 'sem cebola',
  });
  assert.deepEqual(lines.map((l) => l.text), ['Sabores: A / B', '+ Catupiry por cima (R$ 8,00)', 'Obs.: sem cebola']);
});

test('itemDetailLines: combo mostra escolhas e adicionais sob a escolha', () => {
  const lines = itemDetailLines({
    kind: 'combo', quantity: 2, description: 'Combo Clássico', flavorNames: null, addons: [{ name: 'Borda', priceCents: 500 }],
    choices: [
      { label: 'Pizza', kind: 'pizza', description: 'Calabresa / Mussarela', addons: [{ name: 'Borda', priceCents: 500 }] },
      { label: 'Bebida', kind: 'drink', description: 'Guaraná 2L', addons: [] },
    ],
  });
  assert.deepEqual(lines.map((l) => l.text), ['• Calabresa / Mussarela', '+ Borda (R$ 5,00)', '• Guaraná 2L']);
  assert.deepEqual(lines.map((l) => l.sub), [false, true, false]);
});
