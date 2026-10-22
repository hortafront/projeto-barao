import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../helpers/browserAliases.js';

const { formatWeekdays, takenWeekdays, comboPayload, todayComboName } =
  await import('../../../public/admin/js/combos.js');

test('formatWeekdays: abreviações em ordem de semana', () => {
  assert.equal(formatWeekdays([2, 4]), 'Ter · Qui');
  assert.equal(formatWeekdays([4, 0, 2]), 'Dom · Ter · Qui');
  assert.equal(formatWeekdays([]), '');
});

test('takenWeekdays: dia -> nome do outro combo, ignora o próprio', () => {
  const combos = [
    { id: 'a', name: 'Combo Clássico', weekdays: [4, 5] },
    { id: 'b', name: 'Combo Especial', weekdays: [6] },
  ];
  const map = takenWeekdays(combos, 'b');
  assert.equal(map.get(4), 'Combo Clássico');
  assert.equal(map.get(5), 'Combo Clássico');
  assert.equal(map.has(6), false);
  assert.equal(takenWeekdays(combos, null).get(6), 'Combo Especial');
});

test('comboPayload: reais -> centavos, vagas na ordem, dias ordenados', () => {
  const body = comboPayload({
    name: '  Combo Clássico ', description: ' x ', price: '36,90', weekdays: [4, 2],
    slots: [
      { label: ' Pizza ', kind: 'pizza', productIds: ['p1', 'p2'] },
      { label: 'Bebida', kind: 'drink', productIds: ['d1'] },
    ],
  });
  assert.deepEqual(body, {
    name: 'Combo Clássico', description: 'x', priceCents: 3690, weekdays: [2, 4],
    slots: [
      { label: 'Pizza', kind: 'pizza', productIds: ['p1', 'p2'] },
      { label: 'Bebida', kind: 'drink', productIds: ['d1'] },
    ],
  });
});

test('comboPayload: preço inválido ou zero lança erro de campo', () => {
  for (const price of ['', 'abc', '0,00']) {
    assert.throws(() => comboPayload({ name: 'x', price, weekdays: [1], slots: [] }), (e) => e.field === 'price');
  }
});

test('todayComboName usa o dia de Fortaleza', () => {
  const combos = [{ id: 'a', name: 'Combo Quinta', weekdays: [4] }];
  assert.equal(todayComboName(combos, new Date('2026-10-22T02:59:00Z')), null); // quarta 23:59
  assert.equal(todayComboName(combos, new Date('2026-10-22T03:00:00Z')), 'Combo Quinta'); // quinta 00:00
  assert.equal(todayComboName([], new Date('2026-10-22T12:00:00Z')), null);
});
