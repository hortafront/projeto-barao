import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { priceOrderItems, collectProductIds, assertChangeIsValid } from '../../src/services/pricing.service.js';
import { seedProducts, IDS } from '../helpers/fakeDb.js';

describe('priceOrderItems (servidor)', () => {
  const productsById = () => new Map(seedProducts().map((p) => [p.id, p]));
  const pizza = (flavorIds, addonIds = [], quantity = 1) => ({ kind: 'pizza', flavorIds, addonIds, quantity, notes: '' });

  it('monta snapshot com preço do BANCO (sabor mais caro + addons)', () => {
    const [item] = priceOrderItems([pizza([IDS.calabresa, IDS.frango], [IDS.bordaCatupiry])], productsById());
    assert.equal(item.description, 'Pizza meio a meio: Calabresa / Frango');
    assert.deepEqual(item.productIds, [IDS.calabresa, IDS.frango, IDS.bordaCatupiry]);
    assert.deepEqual(item.flavorNames, ['Calabresa', 'Frango']);
    assert.equal(item.baseUnitCents, 3499);
    assert.equal(item.unitPriceCents, 3949);
    assert.equal(item.lineTotalCents, 3949);
    assert.deepEqual(item.addons.map((a) => ({ name: a.name, priceCents: a.priceCents })),
      [{ name: 'Borda Recheada com Catupiry', priceCents: 450 }]);
  });

  it('descrição segue a ordem de sabores enviada', () => {
    const [item] = priceOrderItems([pizza([IDS.frango, IDS.calabresa])], productsById());
    assert.equal(item.description, 'Pizza meio a meio: Frango / Calabresa');
  });

  it('sabores repetidos → VALIDATION_ERROR', () => {
    assert.throws(() => priceOrderItems([pizza([IDS.frango, IDS.frango])], productsById()),
      (err) => err.code === 'VALIDATION_ERROR' && err.status === 400);
  });

  it('duas bordas na mesma pizza → VALIDATION_ERROR "Escolha apenas uma borda por pizza."', () => {
    assert.throws(() => priceOrderItems([pizza([IDS.calabresa], [IDS.bordaCatupiry, IDS.bordaChocolate])], productsById()),
      (err) => {
        assert.equal(err.code, 'VALIDATION_ERROR');
        assert.equal(err.status, 400);
        assert.deepEqual(err.details[0], { path: 'items.0.addonIds', message: 'Escolha apenas uma borda por pizza.' });
        return true;
      });
  });

  it('borda + Catupiry por cima é permitido (grupos diferentes)', () => {
    const [item] = priceOrderItems([pizza([IDS.frango], [IDS.bordaChocolate, IDS.catupiryCima])], productsById());
    assert.equal(item.baseUnitCents, 3499);
    assert.equal(item.unitPriceCents, 3499 + 999 + 450);
    assert.deepEqual(item.addons.map((a) => a.name),
      ['Borda de Chocolate (Garoto ao Leite)', 'Finalize com Catupiry por cima']);
  });

  it('borda + Catupiry por cima com Bacon = 5448', () => {
    const [item] = priceOrderItems([pizza([IDS.bacon], [IDS.bordaChocolate, IDS.catupiryCima])], productsById());
    assert.equal(item.unitPriceCents, 5448);
  });

  it('uma borda por pizza vale por item: pizzas diferentes podem ter bordas diferentes', () => {
    const items = priceOrderItems([
      pizza([IDS.calabresa], [IDS.bordaCatupiry]),
      pizza([IDS.frango], [IDS.bordaChocolate]),
    ], productsById());
    assert.deepEqual(items.map((i) => i.unitPriceCents), [3049 + 450, 3499 + 999]);
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

  it('esgotado + inexistente no mesmo pedido → um só PRODUCT_UNAVAILABLE', () => {
    const map = productsById();
    map.get(IDS.bacon).available = false;
    const ghost = '00000000-0000-4000-8000-0000000000ff';
    assert.throws(() => priceOrderItems([pizza([IDS.bacon]), pizza([ghost])], map), (err) => {
      assert.equal(err.code, 'PRODUCT_UNAVAILABLE');
      assert.equal(err.status, 409);
      assert.deepEqual(err.details, [{ productId: IDS.bacon, name: 'Bacon' }, { productId: ghost, name: null }]);
      assert.equal(err.message, 'Ops! Bacon acabou por hoje. Remova do carrinho para continuar.');
      return true;
    });
  });

  it('sem nome nenhum → mensagem genérica; vários nomes unidos por ", "', () => {
    const ghost = '00000000-0000-4000-8000-0000000000ff';
    assert.throws(() => priceOrderItems([pizza([ghost])], productsById()),
      (err) => err.message === 'Ops! Alguns itens acabaram por hoje. Remova do carrinho para continuar.');
    const map = productsById();
    map.get(IDS.bacon).available = false;
    map.get(IDS.frango).available = false;
    assert.throws(() => priceOrderItems([pizza([IDS.bacon]), pizza([IDS.frango])], map),
      (err) => err.message === 'Ops! Bacon, Frango acabou por hoje. Remova do carrinho para continuar.');
  });
});

describe('collectProductIds', () => {
  it('deduplica ids repetidos entre itens', () => {
    const ids = collectProductIds([
      { kind: 'pizza', flavorIds: [IDS.frango], addonIds: [IDS.bordaCatupiry], quantity: 1 },
      { kind: 'pizza', flavorIds: [IDS.frango, IDS.calabresa], quantity: 1 },
      { kind: 'drink', productId: IDS.coca1l, quantity: 2 },
      { kind: 'drink', productId: IDS.coca1l, quantity: 1 },
    ]);
    assert.deepEqual(ids, [IDS.frango, IDS.bordaCatupiry, IDS.calabresa, IDS.coca1l]);
  });
});

describe('assertChangeIsValid', () => {
  it('troco menor que o total → 400', () => {
    assert.throws(() => assertChangeIsValid({ method: 'cash', changeForCents: 5000 }, 5949), (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      assert.equal(err.status, 400);
      assert.equal(err.message, 'O troco deve ser para um valor igual ou maior que o total do pedido.');
      return true;
    });
  });

  it('troco suficiente passa; pix ignora troco', () => {
    assert.doesNotThrow(() => assertChangeIsValid({ method: 'cash', changeForCents: 10000 }, 5949));
    assert.doesNotThrow(() => assertChangeIsValid({ method: 'pix', changeForCents: 100 }, 5949));
  });
});
