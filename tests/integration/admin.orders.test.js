import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, IDS } from '../helpers/testkit.js';
import { priceOrderItems } from '../../src/services/pricing.service.js';
import { calcOrderSubtotalCents } from '../../shared/pricing.js';

const users = { 'token-dono': { id: 'u1', email: 'dono@barao.com' } };
const auth = { Authorization: 'Bearer token-dono' };
const MISSING = '00000000-0000-4000-8000-000000000000';

const PIZZA = { kind: 'pizza', flavorIds: [IDS.calabresa, IDS.frango], addonIds: [IDS.bordaCatupiry], quantity: 1, notes: 'sem cebola' };
const DRINK = { kind: 'drink', productId: IDS.coca1lZero, quantity: 2 };

async function seedOrder(db, items = [PIZZA, DRINK], { status, fulfillment = 'delivery' } = {}) {
  const byId = new Map((await db.listProducts()).map((p) => [p.id, p]));
  const priced = priceOrderItems(items, byId);
  const created = await db.createOrder({
    customer: { name: 'João Silva', phone: '85999999999' },
    fulfillment,
    address: fulfillment === 'delivery'
      ? { street: 'Rua X', number: '123', district: 'Bairro Y', reference: 'perto da praça' }
      : null,
    payment: { method: 'cash', changeForCents: 20000 },
    notes: 'Interfone quebrado',
    subtotalCents: calcOrderSubtotalCents(priced),
    items: priced,
  });
  if (status) await db.updateOrderStatus(created.id, status);
  return created;
}

describe('GET /api/admin/orders', () => {
  it('exige token', async () => {
    const { app } = makeApp({ users });
    assert.equal((await request(app).get('/api/admin/orders')).status, 401);
  });

  it('25 pedidos no dia: página 1 com 20, página 2 com 5, total 25, createdAt desc', async () => {
    const { app, db } = makeApp({ users });
    for (let i = 0; i < 25; i += 1) await seedOrder(db, [DRINK]);
    const q = '?from=2026-10-18&to=2026-10-18';
    const p1 = await request(app).get(`/api/admin/orders${q}`).set(auth);
    assert.equal(p1.status, 200);
    assert.equal(p1.body.orders.length, 20);
    assert.equal(p1.body.total, 25);
    assert.equal(p1.body.page, 1);
    assert.equal(p1.body.pageSize, 20);
    const p2 = await request(app).get(`/api/admin/orders${q}&page=2`).set(auth);
    assert.equal(p2.body.orders.length, 5);
    assert.equal(p2.body.page, 2);
    const dates = p1.body.orders.map((o) => o.createdAt);
    assert.deepEqual(dates, [...dates].sort().reverse());
  });

  it('item da lista é plano, com os campos do spec 5.4 e sem endereço/itens', async () => {
    const { app, db } = makeApp({ users });
    const { id } = await seedOrder(db);
    const res = await request(app).get('/api/admin/orders').set(auth);
    const [o] = res.body.orders;
    assert.deepEqual(Object.keys(o).sort(), [
      'code', 'createdAt', 'customerName', 'customerPhone', 'fulfillment', 'id', 'paymentMethod', 'status', 'subtotalCents',
    ]);
    assert.equal(o.id, id);
    assert.equal(o.customerName, 'João Silva');
    assert.equal(o.paymentMethod, 'cash');
    assert.equal(o.status, 'received');
  });

  it('from > to → 400; intervalo de 367 dias → 400; data malformada → 400; 366 dias é aceito', async () => {
    const { app } = makeApp({ users });
    for (const q of ['from=2026-10-20&to=2026-10-18', 'from=2025-10-17&to=2026-10-19', 'from=18/10/2026']) {
      const res = await request(app).get(`/api/admin/orders?${q}`).set(auth);
      assert.equal(res.status, 400, q);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    }
    const ok = await request(app).get('/api/admin/orders?from=2025-10-18&to=2026-10-19').set(auth);
    assert.equal(ok.status, 200);
  });

  it('só from ou só to → o outro é igual', async () => {
    const { app, db } = makeApp({ users });
    await seedOrder(db);
    assert.equal((await request(app).get('/api/admin/orders?from=2026-10-18').set(auth)).body.total, 1);
    assert.equal((await request(app).get('/api/admin/orders?to=2026-10-19').set(auth)).body.total, 0);
  });

  it('Review Focus 2: pedido às 22:00 locais pertence ao dia local (não ao dia UTC)', async () => {
    const { app, db } = makeApp({ users, now: '2026-10-19T01:00:00Z' });
    await seedOrder(db);
    const day18 = await request(app).get('/api/admin/orders?from=2026-10-18&to=2026-10-18').set(auth);
    assert.equal(day18.body.orders.length, 1);
    const day19 = await request(app).get('/api/admin/orders?from=2026-10-19&to=2026-10-19').set(auth);
    assert.equal(day19.body.orders.length, 0);
  });

  it('sem parâmetros usa "hoje" local (22:30 local = 01:30 UTC do dia seguinte)', async () => {
    const { app, db } = makeApp({ users, now: '2026-10-19T01:30:00Z' });
    await seedOrder(db);
    const res = await request(app).get('/api/admin/orders').set(auth);
    assert.equal(res.body.orders.length, 1);
    assert.equal(res.body.total, 1);
  });
});

describe('GET /api/admin/orders/:id', () => {
  it('entrega: campos planos de endereço e itens com addons', async () => {
    const { app, db } = makeApp({ users });
    const { id } = await seedOrder(db);
    const res = await request(app).get(`/api/admin/orders/${id}`).set(auth);
    assert.equal(res.status, 200);
    const o = res.body.order;
    assert.equal(o.code, 'BR-0001');
    assert.equal(o.addressStreet, 'Rua X');
    assert.equal(o.addressNumber, '123');
    assert.equal(o.addressDistrict, 'Bairro Y');
    assert.equal(o.addressReference, 'perto da praça');
    assert.equal(o.changeForCents, 20000);
    assert.equal(o.notes, 'Interfone quebrado');
    assert.equal(o.items.length, 2);
    assert.deepEqual(o.items[0].addons, [{ name: 'Borda Recheada com Catupiry', priceCents: 450 }]);
    assert.equal(o.customer, undefined);
    assert.equal(o.address, undefined);
  });

  it('retirada: addressStreet null', async () => {
    const { app, db } = makeApp({ users });
    const { id } = await seedOrder(db, [DRINK], { fulfillment: 'pickup' });
    const o = (await request(app).get(`/api/admin/orders/${id}`).set(auth)).body.order;
    assert.equal(o.fulfillment, 'pickup');
    assert.equal(o.addressStreet, null);
    assert.equal(o.addressNumber, null);
  });

  it('id inexistente → 404 NOT_FOUND; id mal formado → 400', async () => {
    const { app } = makeApp({ users });
    const missing = await request(app).get(`/api/admin/orders/${MISSING}`).set(auth);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'NOT_FOUND');
    assert.equal((await request(app).get('/api/admin/orders/abc').set(auth)).status, 400);
  });
});

describe('PATCH /api/admin/orders/:id/status', () => {
  it('confirmed → 200 e persiste; volta para received', async () => {
    const { app, db } = makeApp({ users });
    const { id } = await seedOrder(db);
    const r1 = await request(app).patch(`/api/admin/orders/${id}/status`).set(auth).send({ status: 'confirmed' });
    assert.equal(r1.status, 200);
    assert.equal(r1.body.order.status, 'confirmed');
    assert.equal((await db.getOrderById(id)).status, 'confirmed');
    const r2 = await request(app).patch(`/api/admin/orders/${id}/status`).set(auth).send({ status: 'received' });
    assert.equal(r2.body.order.status, 'received');
  });

  it("status 'x' → 400; id inexistente → 404", async () => {
    const { app, db } = makeApp({ users });
    const { id } = await seedOrder(db);
    const bad = await request(app).patch(`/api/admin/orders/${id}/status`).set(auth).send({ status: 'x' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'VALIDATION_ERROR');
    const missing = await request(app).patch(`/api/admin/orders/${MISSING}/status`).set(auth).send({ status: 'confirmed' });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'NOT_FOUND');
  });
});
