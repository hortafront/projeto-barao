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

  it('sem nome nenhum → mensagem genérica; 2 e 3 nomes no plural com "e"', () => {
    const ghost = '00000000-0000-4000-8000-0000000000ff';
    assert.throws(() => priceOrderItems([pizza([ghost])], productsById()),
      (err) => err.message === 'Ops! Alguns itens acabaram por hoje. Remova do carrinho para continuar.');
    const map = productsById();
    map.get(IDS.bacon).available = false;
    map.get(IDS.frango).available = false;
    assert.throws(() => priceOrderItems([pizza([IDS.bacon]), pizza([IDS.frango])], map),
      (err) => err.message === 'Ops! Bacon e Frango acabaram por hoje. Remova do carrinho para continuar.');
    map.get(IDS.portuguesa).available = false;
    assert.throws(() => priceOrderItems([pizza([IDS.bacon]), pizza([IDS.frango]), pizza([IDS.portuguesa])], map),
      (err) => err.message === 'Ops! Bacon, Frango e Portuguesa acabaram por hoje. Remova do carrinho para continuar.');
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

describe('priceOrderItems — combo do dia', async () => {
  const { createFakeDb } = await import('../helpers/fakeDb.js');
  const { seedCombo } = await import('../helpers/testkit.js');
  const productsById = () => new Map(seedProducts().map((p) => [p.id, p]));
  const db = createFakeDb();
  const combo = await seedCombo(db);
  const opts = (extra = {}) => ({ combosById: new Map([[combo.id, combo]]), weekday: 4, ...extra });
  const comboItem = (slots, extra = {}) => ({ kind: 'combo', comboId: combo.id, quantity: 1, notes: '', slots, ...extra });
  const pz = (flavorIds, addonIds = []) => ({ kind: 'pizza', flavorIds, addonIds });
  const dk = (productId = IDS.coca1l) => ({ kind: 'drink', productId });
  const fails = (items, o, code, status, path, message) => assert.throws(
    () => priceOrderItems(items, productsById(), o),
    (err) => {
      assert.equal(err.code, code);
      assert.equal(err.status, status);
      if (path) assert.equal(err.details[0].path, path);
      if (message) assert.equal(err.message, message);
      return true;
    });

  it('collectProductIds inclui produtos dos slots', () => {
    const ids = collectProductIds([comboItem([pz([IDS.calabresa], [IDS.bordaCatupiry]), dk()])]);
    assert.deepEqual(ids.sort(), [IDS.calabresa, IDS.bordaCatupiry, IDS.coca1l].sort());
  });

  it('combo válido: preço do combo + adicionais, snapshot por vaga', () => {
    const [item] = priceOrderItems([comboItem([pz([IDS.calabresa, IDS.mussarela], [IDS.bordaCatupiry]), dk()], { quantity: 2 })], productsById(), opts());
    assert.equal(item.kind, 'combo');
    assert.equal(item.comboId, combo.id);
    assert.equal(item.description, 'Combo Clássico');
    assert.equal(item.baseUnitCents, 3690);
    assert.equal(item.unitPriceCents, 4140);
    assert.equal(item.lineTotalCents, 8280);
    assert.equal(item.flavorNames, null);
    assert.deepEqual(item.choices, [
      { label: 'Escolha sua pizza', kind: 'pizza', description: 'Pizza meio a meio: Calabresa / Mussarela', addons: [{ name: 'Borda Recheada com Catupiry', priceCents: 450 }] },
      { label: 'Escolha o refrigerante', kind: 'drink', description: 'Coca-Cola 1 Litro', addons: [] },
    ]);
    assert.deepEqual(item.addons, [{ name: 'Borda Recheada com Catupiry', priceCents: 450 }]);
    assert.deepEqual(item.productIds, [IDS.calabresa, IDS.mussarela, IDS.bordaCatupiry, IDS.coca1l]);
  });

  it('addon em flavorIds → 400; sabor em addonIds → 400', () => {
    fails([comboItem([pz([IDS.bordaCatupiry]), dk()])], opts(), 'VALIDATION_ERROR', 400);
    fails([comboItem([pz([IDS.mista], [IDS.mussarela]), dk()])], opts(), 'VALIDATION_ERROR', 400, 'items.0.slots.0.addonIds');
  });

  it('collectComboIds deduplica', async () => {
    const { collectComboIds } = await import('../../src/services/pricing.service.js');
    const a = comboItem([pz([IDS.mista]), dk()]);
    assert.deepEqual(collectComboIds([a, a, pizza2()]), [combo.id]);
    function pizza2() { return { kind: 'pizza', flavorIds: [IDS.mista], addonIds: [], quantity: 1 }; }
  });

  it('pizza inteira usa "Pizza X"', () => {
    const [item] = priceOrderItems([comboItem([pz([IDS.mista]), dk()])], productsById(), opts());
    assert.equal(item.choices[0].description, 'Pizza Mista');
    assert.equal(item.unitPriceCents, 3690);
  });

  it('combo inexistente → 409', () => {
    fails([comboItem([pz([IDS.mista]), dk()])], { combosById: new Map(), weekday: 4 }, 'PRODUCT_UNAVAILABLE', 409, null, 'Este combo não está mais disponível.');
  });

  it('combo esgotado ou fora do dia → 409 "O {nome} não está disponível hoje."', () => {
    const msg = 'O Combo Clássico não está disponível hoje.';
    fails([comboItem([pz([IDS.mista]), dk()])], opts({ weekday: 5 }), 'PRODUCT_UNAVAILABLE', 409, null, msg);
    fails([comboItem([pz([IDS.mista]), dk()])], { combosById: new Map([[combo.id, { ...combo, available: false }]]), weekday: 4 }, 'PRODUCT_UNAVAILABLE', 409, null, msg);
  });

  it('vagas diferentes (quantidade ou kind) → 400 items.0.slots', () => {
    fails([comboItem([pz([IDS.mista])])], opts(), 'VALIDATION_ERROR', 400, 'items.0.slots');
    fails([comboItem([dk(), pz([IDS.mista])])], opts(), 'VALIDATION_ERROR', 400, 'items.0.slots');
  });

  it('produto fora da vaga → 400; sabor repetido → 400', () => {
    fails([comboItem([pz([IDS.frango]), dk()])], opts(), 'VALIDATION_ERROR', 400, 'items.0.slots.0.flavorIds');
    fails([comboItem([pz([IDS.mista]), dk(IDS.guarana1l)])], opts(), 'VALIDATION_ERROR', 400, 'items.0.slots.1.productId');
    fails([comboItem([pz([IDS.mista, IDS.mista]), dk()])], opts(), 'VALIDATION_ERROR', 400, 'items.0.slots.0.flavorIds');
  });

  it('produto esgotado → 409 agregado', () => {
    const map = productsById();
    map.set(IDS.mista, { ...map.get(IDS.mista), available: false });
    assert.throws(() => priceOrderItems([comboItem([pz([IDS.mista]), dk()])], map, opts()),
      (err) => err.code === 'PRODUCT_UNAVAILABLE' && err.status === 409 && /Mista acabou/.test(err.message));
  });

  it('uma borda por pizza vale por vaga', async () => {
    const c2 = await seedCombo(createFakeDb(), {
      slots: [
        { label: 'Pizza 1', kind: 'pizza', productIds: [IDS.mista] },
        { label: 'Pizza 2', kind: 'pizza', productIds: [IDS.mussarela] },
      ],
    });
    const o = { combosById: new Map([[c2.id, c2]]), weekday: 4 };
    const mk = (a, b) => ({ kind: 'combo', comboId: c2.id, quantity: 1, slots: [pz([IDS.mista], a), pz([IDS.mussarela], b)] });
    const [item] = priceOrderItems([mk([IDS.bordaCatupiry], [IDS.bordaChocolate])], productsById(), o);
    assert.equal(item.unitPriceCents, 3690 + 450 + 999);
    fails([mk([IDS.bordaCatupiry, IDS.bordaChocolate], [])], o, 'VALIDATION_ERROR', 400, 'items.0.slots.0.addonIds', 'Escolha apenas uma borda por pizza.');
  });
});
