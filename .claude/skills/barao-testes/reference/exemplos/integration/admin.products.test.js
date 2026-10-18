// tests/integration/admin.products.test.js — exclusão de produto, config pública do login e formatos de resposta do admin.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, validOrder, IDS } from '../helpers/testkit.js';

const users = { 'token-dono': { id: 'u1', email: 'dono@barao.com' } };
const auth = { Authorization: 'Bearer token-dono' };

describe('GET /api/admin-config (pública)', () => {
  it('devolve URL e ANON key sem exigir token', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/admin-config');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { supabaseUrl: 'https://fake.supabase.co', supabaseAnonKey: 'fake-anon-key' });
    assert.match(res.headers['cache-control'], /max-age=\d+/);
  });
});

describe('DELETE /api/admin/products/:id', () => {
  it('produto que nunca entrou em pedido → 204 e some da lista', async () => {
    const { app, db } = makeApp({ users });
    const res = await request(app).delete(`/api/admin/products/${IDS.carneDoSol}`).set(auth);
    assert.equal(res.status, 204);
    assert.equal(await db.getProductById(IDS.carneDoSol), null);
  });

  it('sabor que já está em pedido → 409 PRODUCT_HAS_ORDERS e o produto continua', async () => {
    const { app, db } = makeApp({ users });
    assert.equal((await request(app).post('/api/orders').send(validOrder())).status, 201);
    const res = await request(app).delete(`/api/admin/products/${IDS.frango}`).set(auth);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'PRODUCT_HAS_ORDERS');
    assert.ok(await db.getProductById(IDS.frango));
  });

  it('addon que já está em pedido também → 409 PRODUCT_HAS_ORDERS (checagem por id, não por nome)', async () => {
    const { app } = makeApp({ users });
    await request(app).post('/api/orders').send(validOrder());
    const res = await request(app).delete(`/api/admin/products/${IDS.bordaCatupiry}`).set(auth);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'PRODUCT_HAS_ORDERS');
  });

  it('id inexistente → 404 NOT_FOUND', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).delete('/api/admin/products/00000000-0000-4000-8000-999999999999').set(auth);
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });
});

describe('formatos de resposta do admin', () => {
  it('GET /api/admin/products → { products }', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).get('/api/admin/products').set(auth);
    assert.equal(res.status, 200);
    assert.equal(res.body.products.length, 16);
  });

  it('GET /api/admin/orders → { orders, page, pageSize, total }; GET /:id → { order } com items', async () => {
    const { app } = makeApp({ users });
    await request(app).post('/api/orders').send(validOrder());
    const list = await request(app).get('/api/admin/orders?from=2026-10-18&to=2026-10-18').set(auth);
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 1);
    assert.equal(list.body.page, 1);
    assert.equal(typeof list.body.pageSize, 'number');
    assert.equal(list.body.orders.length, 1);

    const one = await request(app).get(`/api/admin/orders/${list.body.orders[0].id}`).set(auth);
    assert.equal(one.status, 200);
    assert.equal(one.body.order.code, 'BR-0001');
    assert.equal(one.body.order.items.length, 2);
    assert.deepEqual(one.body.order.items[0].addons, [{ name: 'Borda Recheada com Catupiry', priceCents: 450 }]);
  });
});
