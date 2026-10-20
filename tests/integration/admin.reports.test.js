import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, IDS } from '../helpers/testkit.js';
import { priceOrderItems } from '../../src/services/pricing.service.js';
import { calcOrderSubtotalCents } from '../../shared/pricing.js';

const users = { 'token-dono': { id: 'u1', email: 'dono@barao.com' } };
const auth = { Authorization: 'Bearer token-dono' };
const SUMMARY = '/api/admin/reports/summary?from=2026-10-18&to=2026-10-18';

const drink = (productId, quantity = 1) => ({ kind: 'drink', productId, quantity });
const pizza = (flavorIds, quantity = 1) => ({ kind: 'pizza', flavorIds, addonIds: [], quantity });

async function seedOrder(db, items, { status } = {}) {
  const byId = new Map((await db.listProducts()).map((p) => [p.id, p]));
  const priced = priceOrderItems(items, byId);
  const subtotalCents = calcOrderSubtotalCents(priced);
  const created = await db.createOrder({
    customer: { name: 'João Silva', phone: '85999999999' },
    fulfillment: 'pickup',
    address: null,
    payment: { method: 'pix' },
    notes: null,
    subtotalCents,
    items: priced,
  });
  if (status) await db.updateOrderStatus(created.id, status);
  return { ...created, subtotalCents };
}

describe('GET /api/admin/reports/summary', () => {
  it('exige token', async () => {
    const { app } = makeApp({ users });
    assert.equal((await request(app).get('/api/admin/reports/summary')).status, 401);
  });

  it('exclui cancelado da contagem e do faturamento', async () => {
    const { app, db } = makeApp({ users });
    const a = await seedOrder(db, [drink(IDS.coca600)]);
    const b = await seedOrder(db, [drink(IDS.coca1l, 2)]);
    await seedOrder(db, [drink(IDS.guarana1l)], { status: 'canceled' });
    const res = await request(app).get(SUMMARY).set(auth);
    assert.equal(res.status, 200);
    assert.equal(res.body.ordersCount, 2);
    assert.equal(res.body.grossCents, a.subtotalCents + b.subtotalCents);
    assert.ok(res.body.grossCents > 0);
  });

  it('topItems agrupa por descrição e desempata por nome', async () => {
    const { app, db } = makeApp({ users });
    await seedOrder(db, [pizza([IDS.calabresa], 2), drink(IDS.coca600, 1)]);
    await seedOrder(db, [pizza([IDS.calabresa], 1), drink(IDS.coca1l, 3)]);
    const res = await request(app).get(SUMMARY).set(auth);
    const names = res.body.topItems.map((t) => t.name);
    assert.deepEqual(res.body.topItems.map((t) => t.quantity), [3, 3, 1]);
    assert.equal(new Set(names).size, 3);
    assert.deepEqual(names.slice(0, 2), [...names.slice(0, 2)].sort((x, y) => x.localeCompare(y)));
    assert.ok(names.includes('Pizza Calabresa'));
  });

  it('topItems tem no máximo 10 itens (11 descrições distintas)', async () => {
    const { app, db } = makeApp({ users });
    const flavors = [IDS.mista, IDS.calabresa, IDS.mussarela, IDS.marguerita, IDS.frango, IDS.portuguesa, IDS.bacon, IDS.carneDoSol];
    await seedOrder(db, [...flavors.map((f) => pizza([f])), drink(IDS.coca600), drink(IDS.coca1l), drink(IDS.guarana1l)]);
    const res = await request(app).get(SUMMARY).set(auth);
    assert.equal(res.body.topItems.length, 10);
  });

  it('Review Focus 2: pedido às 22:00 locais conta no dia local', async () => {
    const { app, db } = makeApp({ users, now: '2026-10-19T01:00:00Z' });
    await seedOrder(db, [drink(IDS.coca600)]);
    const d18 = await request(app).get(SUMMARY).set(auth);
    assert.equal(d18.body.ordersCount, 1);
    const d19 = await request(app).get('/api/admin/reports/summary?from=2026-10-19&to=2026-10-19').set(auth);
    assert.equal(d19.body.ordersCount, 0);
    assert.equal(d19.body.grossCents, 0);
    assert.deepEqual(d19.body.topItems, []);
  });

  it('sem parâmetros usa hoje local; intervalo inválido → 400', async () => {
    const { app, db } = makeApp({ users, now: '2026-10-19T01:30:00Z' });
    await seedOrder(db, [drink(IDS.coca600)]);
    assert.equal((await request(app).get('/api/admin/reports/summary').set(auth)).body.ordersCount, 1);
    const bad = await request(app).get('/api/admin/reports/summary?from=2026-10-20&to=2026-10-18').set(auth);
    assert.equal(bad.status, 400);
  });
});
