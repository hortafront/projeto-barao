import { test } from 'node:test';
import assert from 'node:assert/strict';

const { describeShift } = await import('../../../public/admin/js/hours.js');
const { maskPhoneBR, toWhatsAppDigits } = await import('../../../public/admin/js/store.js');

test('describeShift: turno que vira a meia-noite', () => {
  assert.equal(describeShift({ opensAt: '18:00', closesAt: '00:30', isClosed: false }), '18:00 até 00:30 do dia seguinte');
});

test('describeShift: turno no mesmo dia', () => {
  assert.equal(describeShift({ opensAt: '18:00', closesAt: '23:30', isClosed: false }), '18:00 até 23:30');
});

test('describeShift: fechado e inválido (abre = fecha)', () => {
  assert.equal(describeShift({ opensAt: '18:00', closesAt: '23:30', isClosed: true }), 'Fechado');
  assert.equal(describeShift({ opensAt: '18:00', closesAt: '18:00', isClosed: false }), null);
});

test('toWhatsAppDigits normaliza para 55 + DDD + número', () => {
  assert.equal(toWhatsAppDigits('(85) 98888-7777'), '5585988887777');
  assert.equal(toWhatsAppDigits('+55 85 98888-7777'), '5585988887777');
  assert.equal(toWhatsAppDigits('(85) 9888'), null);
});

test('maskPhoneBR formata dígitos com 55', () => {
  assert.equal(maskPhoneBR('5585997687641'), '(85) 99768-7641');
  assert.equal(maskPhoneBR('8599'), '(85) 99');
});
