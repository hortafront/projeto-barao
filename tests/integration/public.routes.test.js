import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, seedCombo } from '../helpers/testkit.js';
import { SUNDAY_20H, TUESDAY_19H } from '../helpers/clock.js';
import { seedProducts, IDS, CATEGORY_IDS } from '../helpers/fakeDb.js';

const PUBLIC_KEYS = ['addonGroup', 'available', 'description', 'id', 'imageUrl', 'kind', 'name', 'priceCents'];

describe('GET /api/menu', () => {
  test('categorias e produtos na ordem do cardápio', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/menu').expect(200);
    assert.deepEqual(res.body.categories.map((c) => c.slug), ['classicas', 'especiais', 'bebidas', 'adicionais']);
    assert.deepEqual(res.body.categories[0].products.map((p) => p.name), ['Mista', 'Calabresa', 'Mussarela', 'Marguerita']);
  });

  test('produto indisponível continua listado e só expõe as chaves públicas', async () => {
    const products = seedProducts().map((p) => (p.id === IDS.bacon ? { ...p, available: false } : p));
    const { app } = makeApp({ products });
    const res = await request(app).get('/api/menu').expect(200);
    const bacon = res.body.categories.find((c) => c.slug === 'especiais').products.find((p) => p.id === IDS.bacon);
    assert.equal(bacon.available, false);
    assert.equal(bacon.priceCents, 3999);
    for (const c of res.body.categories) {
      for (const p of c.products) assert.deepEqual(Object.keys(p).sort(), PUBLIC_KEYS);
    }
  });

  test('addonGroup: bordas "borda", Catupiry por cima null', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/menu').expect(200);
    const addons = res.body.categories.find((c) => c.slug === 'adicionais').products;
    const byId = Object.fromEntries(addons.map((p) => [p.id, p.addonGroup]));
    assert.equal(byId[IDS.bordaCatupiry], 'borda');
    assert.equal(byId[IDS.bordaChocolate], 'borda');
    assert.equal(byId[IDS.catupiryCima], null);
  });

  test('mesmo sortOrder desempata por nome', async () => {
    const extra = (id, name) => ({ ...seedProducts()[0], id, name, sortOrder: 9 });
    const products = [
      ...seedProducts(),
      extra('00000000-0000-4000-8000-000000000901', 'Zebra'),
      extra('00000000-0000-4000-8000-000000000902', 'Abacaxi'),
    ];
    const { app } = makeApp({ products });
    const res = await request(app).get('/api/menu').expect(200);
    const names = res.body.categories[0].products.map((p) => p.name);
    assert.deepEqual(names.slice(-2), ['Abacaxi', 'Zebra']);
  });

  test('categoria sem produtos é omitida', async () => {
    const products = seedProducts().filter((p) => p.categoryId !== CATEGORY_IDS.bebidas);
    const { app } = makeApp({ products });
    const res = await request(app).get('/api/menu').expect(200);
    assert.deepEqual(res.body.categories.map((c) => c.slug), ['classicas', 'especiais', 'adicionais']);
  });

  test('Cache-Control público de 30s', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/menu').expect(200);
    assert.equal(res.headers['cache-control'], 'public, max-age=30');
  });

  test('falha do banco vira 500 INTERNAL sem stack', async () => {
    const { app, db } = makeApp();
    db.getMenu = async () => { throw new Error('boom secreto'); };
    const res = await request(app).get('/api/menu').expect(500);
    assert.equal(res.body.error.code, 'INTERNAL');
    assert.equal('stack' in res.body, false);
    assert.equal('stack' in res.body.error, false);
    assert.doesNotMatch(JSON.stringify(res.body), /boom secreto/);
  });
});

describe('GET /api/status', () => {
  test('domingo 20h: aberto por horário', async () => {
    const { app } = makeApp({ now: SUNDAY_20H });
    const res = await request(app).get('/api/status').expect(200);
    assert.equal(res.body.open, true);
    assert.equal(res.body.reason, 'hours');
    assert.equal(res.body.nextOpenAt, null);
  });

  test('terça 19h: fechada, com próxima abertura e horário de hoje', async () => {
    const { app } = makeApp({ now: TUESDAY_19H });
    const res = await request(app).get('/api/status').expect(200);
    assert.equal(res.body.open, false);
    assert.equal(res.body.nextOpenAt, '2026-10-22T21:00:00.000Z');
    assert.equal(res.body.todayHours.weekday, 2);
  });

  test('override closed', async () => {
    const { app } = makeApp({ now: SUNDAY_20H, settings: { storeOverride: 'closed' } });
    const res = await request(app).get('/api/status').expect(200);
    assert.equal(res.body.open, false);
    assert.equal(res.body.reason, 'override_closed');
  });

  test('override open na terça abre a loja', async () => {
    const { app } = makeApp({ now: TUESDAY_19H, settings: { storeOverride: 'open' } });
    const res = await request(app).get('/api/status').expect(200);
    assert.equal(res.body.open, true);
    assert.equal(res.body.reason, 'override_open');
  });

  test('Cache-Control no-store', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/status').expect(200);
    assert.equal(res.headers['cache-control'], 'no-store');
  });
});

test('rotas públicas continuam sem exigir token', async () => {
  const { app } = makeApp();
  await request(app).get('/api/menu').expect(200);
  await request(app).get('/api/status').expect(200);
});

describe('GET /api/menu — combo do dia', () => {
  const THURSDAY_NOON = '2026-10-22T15:00:00Z'; // quinta 12:00 Fortaleza

  test('sem combo cadastrado → combo: null', async () => {
    const { app } = makeApp({ now: THURSDAY_NOON });
    const res = await request(app).get('/api/menu').expect(200);
    assert.equal(res.body.combo, null);
  });

  test('quinta → combo com vagas e chaves públicas', async () => {
    const { app, db } = makeApp({ now: THURSDAY_NOON });
    const created = await seedCombo(db);
    const res = await request(app).get('/api/menu').expect(200);
    const { combo } = res.body;
    assert.deepEqual(Object.keys(combo).sort(), ['available', 'description', 'id', 'imageUrl', 'name', 'priceCents', 'slots']);
    assert.equal(combo.id, created.id);
    assert.equal(combo.priceCents, 3690);
    assert.equal(combo.available, true);
    assert.deepEqual(combo.slots.map((s) => s.kind), ['pizza', 'drink']);
    assert.equal(combo.slots[1].productIds.length, 2);
  });

  test('outro dia da semana → combo: null', async () => {
    const { app, db } = makeApp({ now: SUNDAY_20H });
    await seedCombo(db);
    assert.equal((await request(app).get('/api/menu').expect(200)).body.combo, null);
  });

  test('produto excluído sai das vagas', async () => {
    const products = seedProducts().filter((p) => p.id !== IDS.coca1lZero);
    const { app, db } = makeApp({ now: THURSDAY_NOON, products });
    await seedCombo(db);
    const res = await request(app).get('/api/menu').expect(200);
    assert.deepEqual(res.body.combo.slots[1].productIds, [IDS.coca1l]);
  });

  test('vaga só com esgotados → available: false', async () => {
    const products = seedProducts().map((p) => ([IDS.coca1l, IDS.coca1lZero].includes(p.id) ? { ...p, available: false } : p));
    const { app, db } = makeApp({ now: THURSDAY_NOON, products });
    await seedCombo(db);
    const res = await request(app).get('/api/menu').expect(200);
    assert.equal(res.body.combo.available, false);
  });

  test('virada do dia no fuso de Fortaleza: 02:59Z ainda é quarta, 03:00Z já é quinta', async () => {
    const before = makeApp({ now: '2026-10-22T02:59:00Z' });
    await seedCombo(before.db);
    assert.equal((await request(before.app).get('/api/menu').expect(200)).body.combo, null);
    const after = makeApp({ now: '2026-10-22T03:00:00Z' });
    await seedCombo(after.db);
    assert.ok((await request(after.app).get('/api/menu').expect(200)).body.combo);
  });
});
