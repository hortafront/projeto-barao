import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBRL, parseBRLToCents } from '../../shared/money.js';

test('formatBRL formata centavos em reais', () => {
  assert.equal(formatBRL(3499), 'R$ 34,99');
  assert.equal(formatBRL(0), 'R$ 0,00');
  assert.equal(formatBRL(103499), 'R$ 1.034,99');
});

test('formatBRL usa espaço comum, nunca NBSP', () => {
  assert.ok(!formatBRL(3499).includes(' '));
});

test('formatBRL lança TypeError se não for inteiro', () => {
  assert.throws(() => formatBRL(34.99), TypeError);
});

test('parseBRLToCents converte entradas válidas', () => {
  assert.equal(parseBRLToCents('34,99'), 3499);
  assert.equal(parseBRLToCents('R$ 100'), 10000);
  assert.equal(parseBRLToCents('50.5'), 5050);
  assert.equal(parseBRLToCents('R$ 1.034,99'), 103499);
});

test('parseBRLToCents retorna null para entradas inválidas', () => {
  for (const v of ['', 'abc', '-5', '1,999', 3499, null]) {
    assert.equal(parseBRLToCents(v), null, String(v));
  }
});
