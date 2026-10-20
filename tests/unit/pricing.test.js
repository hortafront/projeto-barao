import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS,
  calcPizzaBaseCents,
  calcPizzaUnitCents,
  calcItemCents,
  calcOrderSubtotalCents,
} from '../../shared/pricing.js';

const p = (priceCents) => ({ priceCents });

test('LIMITS é congelado com os valores do contrato', () => {
  assert.deepEqual(LIMITS, { minFlavors: 1, maxFlavors: 2, minQuantity: 1, maxQuantity: 20, maxItems: 30 });
  assert.ok(Object.isFrozen(LIMITS));
});

test('pizza inteira usa o preço do sabor', () => {
  assert.equal(calcPizzaBaseCents([p(3049)]), 3049);
});

test('meio a meio cobra o sabor mais caro, em qualquer ordem', () => {
  assert.equal(calcPizzaBaseCents([p(3049), p(4299)]), 4299);
  assert.equal(calcPizzaBaseCents([p(4299), p(3049)]), 4299);
});

test('unitário soma addons ao sabor mais caro', () => {
  assert.equal(calcPizzaUnitCents([p(3049), p(3499)], [p(450)]), 3949);
});

test('linha de pizza multiplica (sabor + addons) pela quantidade', () => {
  const item = { kind: 'pizza', flavors: [p(3999)], addons: [p(450), p(999)], quantity: 2 };
  assert.equal(calcItemCents(item), 10896);
});

test('linha de bebida', () => {
  assert.equal(calcItemCents({ kind: 'drink', product: p(1000), quantity: 2 }), 2000);
  assert.equal(calcItemCents({ kind: 'drink', product: p(800), quantity: 3 }), 2400);
});

test('subtotal do pedido soma as linhas', () => {
  const items = [
    { kind: 'pizza', flavors: [p(3049), p(3499)], addons: [p(450)], quantity: 1 },
    { kind: 'drink', product: p(1000), quantity: 2 },
  ];
  assert.equal(calcOrderSubtotalCents(items), 5949);
});

test('RangeError para quantidade de sabores e de itens inválidas', () => {
  assert.throws(() => calcPizzaBaseCents([]), RangeError);
  assert.throws(() => calcPizzaBaseCents([p(1), p(2), p(3)]), RangeError);
  for (const quantity of [0, 21, 1.5]) {
    assert.throws(() => calcItemCents({ kind: 'drink', product: p(1000), quantity }), RangeError);
  }
});

test('TypeError para preço não inteiro/negativo e kind inválido', () => {
  assert.throws(() => calcPizzaBaseCents([p(34.99)]), TypeError);
  assert.throws(() => calcPizzaBaseCents([p(-1)]), TypeError);
  assert.throws(() => calcItemCents({ kind: 'addon', quantity: 1 }), TypeError);
});
