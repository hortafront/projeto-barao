import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../helpers/browserAliases.js';

const { todayInFortaleza, presetRange, formatTimeFortaleza, STATUS_LABEL } =
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
