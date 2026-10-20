// tests/integration/admin.products.test.js — CRUD de produtos do admin, disponibilidade, exclusão e addonGroup.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, IDS } from '../helpers/testkit.js';
import { CATEGORY_IDS } from '../helpers/fakeDb.js';

const users = { 'token-dono': { id: 'u1', email: 'dono@barao.com' } };
const auth = { Authorization: 'Bearer token-dono' };
const MISSING = '00000000-0000-4000-8000-999999999999';
const HAS_ORDERS_MSG = 'Produto já tem pedidos; marque como esgotado em vez de excluir';

/** Cria direto no fake um pedido de uma linha que contém os produtos dados (snapshot coerente). */
async function seedOrderWith(db, productIds) {
  const products = await db.getProductsByIds(productIds);
  const addons = products.filter((p) => p.kind === 'addon');
  const base = products.find((p) => p.kind !== 'addon') ?? (await db.getProductsByIds([IDS.mista]))[0];
  const addonsCents = addons.reduce((s, a) => s + a.priceCents, 0);
  const unitPriceCents = base.priceCents + addonsCents;
  return db.createOrder({
    customer: { name: 'João Silva', phone: '85999999999' },
    fulfillment: 'pickup',
    address: null,
    payment: { method: 'pix' },
    notes: null,
    subtotalCents: unitPriceCents * 2,
    items: [{
      kind: base.kind === 'drink' ? 'drink' : 'pizza',
      description: base.name,
      productIds: [base.id, ...addons.map((a) => a.id)],
      flavorNames: base.kind === 'pizza' ? [base.name] : null,
      addons: addons.map((a) => ({ name: a.name, priceCents: a.priceCents })),
      baseUnitCents: base.priceCents,
      unitPriceCents,
      quantity: 2,
      notes: null,
      lineTotalCents: unitPriceCents * 2,
    }],
  });
}

describe('GET /api/admin/products', () => {
  it('16 itens ordenados por categoria e sortOrder, com categorySlug, createdAt e updatedAt', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).get('/api/admin/products').set(auth);
    assert.equal(res.status, 200);
    assert.equal(res.body.products.length, 16);
    assert.equal(res.body.products[0].name, 'Mista');
    assert.equal(res.body.products[0].categorySlug, 'classicas');
    assert.equal(res.body.products[15].categorySlug, 'adicionais');
    for (const p of res.body.products) {
      assert.equal(typeof p.categorySlug, 'string');
      assert.equal(typeof p.createdAt, 'string');
      assert.equal(typeof p.updatedAt, 'string');
    }
  });
});

describe('POST /api/admin/products', () => {
  it('cria e devolve 201 com AdminProduct', async () => {
    const { app, db } = makeApp({ users });
    const res = await request(app).post('/api/admin/products').set(auth).send({
      categoryId: CATEGORY_IDS.especiais, kind: 'pizza', name: 'Atum', priceCents: 3999,
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.product.name, 'Atum');
    assert.equal(res.body.product.categorySlug, 'especiais');
    assert.ok(await db.getProductById(res.body.product.id));
  });

  it('categoryId inexistente → 400 VALIDATION_ERROR com path categoryId', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).post('/api/admin/products').set(auth).send({
      categoryId: MISSING, kind: 'pizza', name: 'Atum', priceCents: 3999,
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.equal(res.body.error.details[0].path, 'categoryId');
  });
});

describe('PUT /api/admin/products/:id', () => {
  const full = (over = {}) => ({ categoryId: CATEGORY_IDS.especiais, kind: 'pizza', name: 'Bacon', priceCents: 4100, ...over });

  it('válido → 200 com priceCents novo e o banco reflete', async () => {
    const { app, db } = makeApp({ users });
    const res = await request(app).put(`/api/admin/products/${IDS.bacon}`).set(auth).send(full());
    assert.equal(res.status, 200);
    assert.equal(res.body.product.priceCents, 4100);
    assert.equal((await db.getProductById(IDS.bacon)).priceCents, 4100);
  });

  it('sem name → 400', async () => {
    const { app } = makeApp({ users });
    const { name, ...body } = full();
    const res = await request(app).put(`/api/admin/products/${IDS.bacon}`).set(auth).send(body);
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('id inexistente → 404 NOT_FOUND', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).put(`/api/admin/products/${MISSING}`).set(auth).send(full());
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  it('categoryId inexistente → 400 com path categoryId', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).put(`/api/admin/products/${IDS.bacon}`).set(auth).send(full({ categoryId: MISSING }));
    assert.equal(res.status, 400);
    assert.equal(res.body.error.details[0].path, 'categoryId');
  });
});

describe('PATCH /api/admin/products/:id/availability', () => {
  it('admin autorizado consegue marcar produto como esgotado', async () => {
    const { app, db } = makeApp({ users });
    const res = await request(app).patch(`/api/admin/products/${IDS.frango}/availability`).set(auth).send({ available: false });
    assert.equal(res.status, 200);
    assert.equal(res.body.product.available, false);
    assert.equal((await db.getProductById(IDS.frango)).available, false);
  });

  it('available não booleano → 400', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).patch(`/api/admin/products/${IDS.frango}/availability`).set(auth).send({ available: 'no' });
    assert.equal(res.status, 400);
  });

  it(':id não-uuid → 400', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).patch('/api/admin/products/abc/availability').set(auth).send({ available: false });
    assert.equal(res.status, 400);
  });

  it('id inexistente → 404', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).patch(`/api/admin/products/${MISSING}/availability`).set(auth).send({ available: false });
    assert.equal(res.status, 404);
  });
});

describe('DELETE /api/admin/products/:id', () => {
  it('produto que nunca entrou em pedido → 204 e some', async () => {
    const { app, db } = makeApp({ users });
    const res = await request(app).delete(`/api/admin/products/${IDS.carneDoSol}`).set(auth);
    assert.equal(res.status, 204);
    assert.equal(await db.getProductById(IDS.carneDoSol), null);
  });

  it('sabor em pedido → 409 PRODUCT_HAS_ORDERS e o produto continua', async () => {
    const { app, db } = makeApp({ users });
    await seedOrderWith(db, [IDS.frango]);
    const res = await request(app).delete(`/api/admin/products/${IDS.frango}`).set(auth);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'PRODUCT_HAS_ORDERS');
    assert.equal(res.body.error.message, HAS_ORDERS_MSG);
    assert.ok(await db.getProductById(IDS.frango));
  });

  it('bebida em pedido → 409 PRODUCT_HAS_ORDERS', async () => {
    const { app, db } = makeApp({ users });
    await seedOrderWith(db, [IDS.coca1lZero]);
    const res = await request(app).delete(`/api/admin/products/${IDS.coca1lZero}`).set(auth);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'PRODUCT_HAS_ORDERS');
    assert.equal(res.body.error.message, HAS_ORDERS_MSG);
  });

  it('addon em pedido → 409 PRODUCT_HAS_ORDERS (por id)', async () => {
    const { app, db } = makeApp({ users });
    await seedOrderWith(db, [IDS.calabresa, IDS.bordaCatupiry]);
    const res = await request(app).delete(`/api/admin/products/${IDS.bordaCatupiry}`).set(auth);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'PRODUCT_HAS_ORDERS');
    assert.equal(res.body.error.message, HAS_ORDERS_MSG);
  });

  it('id inexistente → 404 NOT_FOUND', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).delete(`/api/admin/products/${MISSING}`).set(auth);
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });
});

describe('addonGroup (no máximo uma borda por pizza)', () => {
  it('POST cria addon com addonGroup "borda"', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).post('/api/admin/products').set(auth).send({
      categoryId: CATEGORY_IDS.adicionais, kind: 'addon', name: 'Borda de Cheddar', priceCents: 600, addonGroup: 'borda',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.product.addonGroup, 'borda');
  });

  it('POST sem addonGroup → null', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).post('/api/admin/products').set(auth).send({
      categoryId: CATEGORY_IDS.adicionais, kind: 'addon', name: 'Orégano extra', priceCents: 100,
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.product.addonGroup, null);
  });

  it('addonGroup em pizza → 400 VALIDATION_ERROR (só addon tem grupo)', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).post('/api/admin/products').set(auth).send({
      categoryId: CATEGORY_IDS.classicas, kind: 'pizza', name: 'Atum', priceCents: 3999, addonGroup: 'borda',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.equal(res.body.error.details[0].path, 'addonGroup');
  });

  it('PUT põe o Catupiry por cima num grupo e tira dele', async () => {
    const { app } = makeApp({ users });
    const put = (addonGroup) => request(app).put(`/api/admin/products/${IDS.catupiryCima}`).set(auth).send({
      categoryId: CATEGORY_IDS.adicionais, kind: 'addon', name: 'Finalize com Catupiry por cima', priceCents: 450, addonGroup,
    });
    assert.equal((await put('borda')).body.product.addonGroup, 'borda');
    assert.equal((await put(null)).body.product.addonGroup, null);
  });
});
