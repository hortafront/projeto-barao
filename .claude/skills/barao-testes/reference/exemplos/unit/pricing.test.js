// tests/unit/pricing.test.js — regra de preço.
// shared/pricing.js (puro; mesmo código no browser e no servidor) — assinaturas da skill barao-cardapio-precos:
//   calcPizzaUnitCents(flavors, addons = [])  flavors/addons: [{ priceCents }]
//   calcItemCents(item)  pizza: { kind, flavors, addons, quantity } | drink: { kind, product, quantity }
//   calcOrderSubtotalCents(items)
// src/services/pricing.service.js: priceOrderItems(items, productsById) — distinção, kind, disponibilidade.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calcPizzaUnitCents, calcItemCents, calcOrderSubtotalCents } from '../../shared/pricing.js';
import { priceOrderItems } from '../../src/services/pricing.service.js';
import { seedProducts, IDS } from '../helpers/fakeDb.js';

const calabresa = { priceCents: 3049 };
const frango = { priceCents: 3499 };
const carneDoSol = { priceCents: 4299 };
const bordaCatupiry = { priceCents: 450 };
const bordaChocolate = { priceCents: 999 };

describe('calcPizzaUnitCents', () => {
  it('pizza inteira custa o preço do sabor', () => {
    assert.equal(calcPizzaUnitCents([calabresa]), 3049);
  });

  it('meio a meio cobra o sabor MAIS CARO, em qualquer ordem', () => {
    assert.equal(calcPizzaUnitCents([calabresa, frango]), 3499);
    assert.equal(calcPizzaUnitCents([frango, calabresa]), 3499);
    assert.equal(calcPizzaUnitCents([carneDoSol, calabresa]), 4299);
  });

  it('addons somam por pizza', () => {
    assert.equal(calcPizzaUnitCents([calabresa, frango], [bordaCatupiry]), 3949);
    assert.equal(calcPizzaUnitCents([frango], [bordaCatupiry, bordaChocolate]), 3499 + 450 + 999);
  });

  it('rejeita 0 ou 3+ sabores', () => {
    assert.throws(() => calcPizzaUnitCents([]), RangeError);
    assert.throws(() => calcPizzaUnitCents([calabresa, frango, carneDoSol]), RangeError);
  });

  it('rejeita preço que não é centavo inteiro (sinal de float no caminho)', () => {
    assert.throws(() => calcPizzaUnitCents([{ priceCents: 30.49 }]), TypeError);
  });
});

describe('calcItemCents / calcOrderSubtotalCents', () => {
  it('quantidade multiplica pizza + addons', () => {
    const item = { kind: 'pizza', flavors: [frango], addons: [bordaChocolate], quantity: 2 };
    assert.equal(calcItemCents(item), 8996); // (3499 + 999) × 2
  });

  it('bebida = preço × quantidade', () => {
    assert.equal(calcItemCents({ kind: 'drink', product: { priceCents: 1000 }, quantity: 2 }), 2000);
  });

  it('rejeita quantidade fora de 1..20 ou não inteira', () => {
    for (const quantity of [0, 21, 1.5, '2']) {
      assert.throws(() => calcItemCents({ kind: 'drink', product: { priceCents: 600 }, quantity }), RangeError, `quantity ${quantity}`);
    }
  });

  it('subtotal do pedido do contrato = R$ 59,49 (5949)', () => {
    const items = [
      { kind: 'pizza', flavors: [calabresa, frango], addons: [bordaCatupiry], quantity: 1 },
      { kind: 'drink', product: { priceCents: 1000 }, quantity: 2 },
    ];
    const subtotal = calcOrderSubtotalCents(items);
    assert.equal(subtotal, 5949);
    assert.ok(Number.isInteger(subtotal));
  });
});

describe('priceOrderItems (servidor)', () => {
  const productsById = () => new Map(seedProducts().map((p) => [p.id, p]));
  const pizza = (flavorIds, addonIds = [], quantity = 1) => ({ kind: 'pizza', flavorIds, addonIds, quantity, notes: '' });

  it('monta snapshot com preço do BANCO (sabor mais caro + addons)', () => {
    const [item] = priceOrderItems([pizza([IDS.calabresa, IDS.frango], [IDS.bordaCatupiry])], productsById());
    assert.equal(item.description, 'Pizza meio a meio: Calabresa / Frango');
    assert.equal(item.baseUnitCents, 3499);
    assert.equal(item.unitPriceCents, 3949);
    assert.equal(item.lineTotalCents, 3949);
    assert.deepEqual(item.productIds, [IDS.calabresa, IDS.frango, IDS.bordaCatupiry]);
    assert.deepEqual(item.addons.map((a) => ({ name: a.name, priceCents: a.priceCents })),
      [{ name: 'Borda Recheada com Catupiry', priceCents: 450 }]);
  });

  it('sabores repetidos → VALIDATION_ERROR', () => {
    assert.throws(() => priceOrderItems([pizza([IDS.frango, IDS.frango])], productsById()),
      (err) => err.code === 'VALIDATION_ERROR' && err.status === 400);
  });

  it('addon repetido → VALIDATION_ERROR', () => {
    assert.throws(() => priceOrderItems([pizza([IDS.frango], [IDS.bordaCatupiry, IDS.bordaCatupiry])], productsById()),
      (err) => err.code === 'VALIDATION_ERROR');
  });

  it('bebida usada como sabor → VALIDATION_ERROR', () => {
    assert.throws(() => priceOrderItems([pizza([IDS.coca600])], productsById()),
      (err) => err.code === 'VALIDATION_ERROR');
  });

  it('sabor esgotado → PRODUCT_UNAVAILABLE com detalhes', () => {
    const map = productsById();
    map.get(IDS.bacon).available = false;
    assert.throws(() => priceOrderItems([pizza([IDS.bacon])], map), (err) => {
      assert.equal(err.code, 'PRODUCT_UNAVAILABLE');
      assert.equal(err.status, 409);
      assert.deepEqual(err.details, [{ productId: IDS.bacon, name: 'Bacon' }]);
      return true;
    });
  });
});
