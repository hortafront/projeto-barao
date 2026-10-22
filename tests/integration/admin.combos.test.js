// tests/integration/admin.combos.test.js — CRUD de combos do admin, disponibilidade, exclusão e upload de imagem.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, seedCombo, bearer, CUSTOMER_A, IDS } from '../helpers/testkit.js';

const users = { 'token-dono': { id: 'u1', email: 'dono@barao.com' } };
const auth = { Authorization: 'Bearer token-dono' };
const MISSING = '00000000-0000-4000-8000-999999999999';
const NOT_FOUND_MSG = 'Combo não encontrado.';
const HAS_ORDERS_MSG = 'Combo já tem pedidos; marque como esgotado em vez de excluir';
const jpeg = (size = 64) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size - 4)]);

const validBody = (overrides = {}) => ({
  name: 'Combo Casal',
  description: 'Duas pizzas',
  priceCents: 5990,
  weekdays: [5],
  slots: [
    { label: 'Pizza', kind: 'pizza', productIds: [IDS.mista, IDS.calabresa] },
    { label: 'Refri', kind: 'drink', productIds: [IDS.coca1l] },
  ],
  ...overrides,
});

describe('autenticação /api/admin/combos', () => {
  it('sem token → 401', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).get('/api/admin/combos');
    assert.equal(res.status, 401);
  });

  it('cliente (e-mail fora da lista) → 403', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).get('/api/admin/combos').set(bearer(CUSTOMER_A));
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });
});

describe('CRUD /api/admin/combos', () => {
  it('GET lista { combos }', async () => {
    const { app, db } = makeApp({ users });
    await seedCombo(db);
    const res = await request(app).get('/api/admin/combos').set(auth);
    assert.equal(res.status, 200);
    assert.equal(res.body.combos.length, 1);
    assert.equal(res.body.combos[0].name, 'Combo Clássico');
    assert.equal(res.body.combos[0].slots.length, 2);
  });

  it('POST cria → 201 { combo } com position pelo índice', async () => {
    const { app, db } = makeApp({ users });
    const res = await request(app).post('/api/admin/combos').set(auth).send(validBody());
    assert.equal(res.status, 201);
    assert.equal(res.body.combo.name, 'Combo Casal');
    assert.deepEqual(res.body.combo.weekdays, [5]);
    assert.deepEqual(res.body.combo.slots.map((s) => s.position), [0, 1]);
    assert.equal((await db.listCombos()).length, 1);
  });

  it('POST com preço em float → 400 VALIDATION_ERROR', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).post('/api/admin/combos').set(auth).send(validBody({ priceCents: 59.9 }));
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('POST em dia já ocupado → 400 com mensagem e details[0].path === weekdays', async () => {
    const { app, db } = makeApp({ users });
    await seedCombo(db); // quinta
    const res = await request(app).post('/api/admin/combos').set(auth).send(validBody({ weekdays: [4] }));
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.equal(res.body.error.message, 'Já existe um combo na quinta-feira: Combo Clássico.');
    assert.equal(res.body.error.details[0].path, 'weekdays');
  });

  it('POST com produto do tipo errado na vaga → 400', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).post('/api/admin/combos').set(auth).send(validBody({
      slots: [{ label: 'Pizza', kind: 'pizza', productIds: [IDS.coca1l] }],
    }));
    assert.equal(res.status, 400);
    assert.equal(res.body.error.details[0].path, 'slots.0.productIds');
  });

  it('PUT atualiza → 200 { combo }; manter os próprios dias passa', async () => {
    const { app, db } = makeApp({ users });
    const combo = await seedCombo(db); // quinta
    const res = await request(app).put(`/api/admin/combos/${combo.id}`).set(auth)
      .send(validBody({ name: 'Combo Novo', weekdays: [4] }));
    assert.equal(res.status, 200);
    assert.equal(res.body.combo.name, 'Combo Novo');
    assert.equal((await db.getCombo(combo.id)).priceCents, 5990);
  });

  it('PUT em dia de outro combo → 400', async () => {
    const { app, db } = makeApp({ users });
    await seedCombo(db); // quinta
    const other = await seedCombo(db, { name: 'Outro', weekdays: [5] });
    const res = await request(app).put(`/api/admin/combos/${other.id}`).set(auth).send(validBody({ weekdays: [4] }));
    assert.equal(res.status, 400);
    assert.equal(res.body.error.details[0].path, 'weekdays');
  });

  it('PUT inexistente → 404', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).put(`/api/admin/combos/${MISSING}`).set(auth).send(validBody());
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
    assert.equal(res.body.error.message, NOT_FOUND_MSG);
  });

  it('id que não é uuid → 400', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).put('/api/admin/combos/abc').set(auth).send(validBody());
    assert.equal(res.status, 400);
  });

  it('DELETE → 204 e some da lista', async () => {
    const { app, db } = makeApp({ users });
    const combo = await seedCombo(db);
    const res = await request(app).delete(`/api/admin/combos/${combo.id}`).set(auth);
    assert.equal(res.status, 204);
    assert.equal((await db.listCombos()).length, 0);
  });

  it('DELETE inexistente → 404', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).delete(`/api/admin/combos/${MISSING}`).set(auth);
    assert.equal(res.status, 404);
    assert.equal(res.body.error.message, NOT_FOUND_MSG);
  });

  it('DELETE de combo que já tem pedido → 409 PRODUCT_HAS_ORDERS', async () => {
    const { app, db } = makeApp({ users });
    const combo = await seedCombo(db);
    await db.createOrder({
      customer: { name: 'João Silva', phone: '85999999999' },
      fulfillment: 'pickup',
      address: null,
      payment: { method: 'pix' },
      notes: null,
      subtotalCents: 3690,
      items: [{
        kind: 'combo',
        comboId: combo.id,
        description: combo.name,
        choices: [],
        productIds: [IDS.mista, IDS.coca1l],
        flavorNames: null,
        addons: [],
        baseUnitCents: 3690,
        unitPriceCents: 3690,
        quantity: 1,
        notes: null,
        lineTotalCents: 3690,
      }],
    });
    const res = await request(app).delete(`/api/admin/combos/${combo.id}`).set(auth);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'PRODUCT_HAS_ORDERS');
    assert.equal(res.body.error.message, HAS_ORDERS_MSG);
    assert.ok(await db.getCombo(combo.id));
  });
});

describe('PATCH /api/admin/combos/:id/availability', () => {
  it('esgota e reativa', async () => {
    const { app, db } = makeApp({ users });
    const combo = await seedCombo(db);
    const off = await request(app).patch(`/api/admin/combos/${combo.id}/availability`).set(auth).send({ available: false });
    assert.equal(off.status, 200);
    assert.equal(off.body.combo.available, false);
    const on = await request(app).patch(`/api/admin/combos/${combo.id}/availability`).set(auth).send({ available: true });
    assert.equal(on.body.combo.available, true);
  });

  it('body inválido → 400; inexistente → 404', async () => {
    const { app, db } = makeApp({ users });
    const combo = await seedCombo(db);
    const bad = await request(app).patch(`/api/admin/combos/${combo.id}/availability`).set(auth).send({ available: 'sim' });
    assert.equal(bad.status, 400);
    const missing = await request(app).patch(`/api/admin/combos/${MISSING}/availability`).set(auth).send({ available: false });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.message, NOT_FOUND_MSG);
  });
});

describe('POST /api/admin/combos/:id/image', () => {
  const url = (id) => `/api/admin/combos/${id}/image`;

  it('JPEG válido → 200 e imageUrl do bucket', async () => {
    const { app, db } = makeApp({ users });
    const combo = await seedCombo(db);
    const res = await request(app).post(url(combo.id)).set(auth)
      .attach('image', jpeg(), { filename: 'c.jpg', contentType: 'image/jpeg' });
    assert.equal(res.status, 200);
    assert.ok(res.body.combo.imageUrl.startsWith('https://fake.supabase.co/storage/v1/object/public/product-images/combos/'));
    assert.equal((await db.getCombo(combo.id)).imageUrl, res.body.combo.imageUrl);
  });

  it('image/gif → 400', async () => {
    const { app, db } = makeApp({ users });
    const combo = await seedCombo(db);
    const res = await request(app).post(url(combo.id)).set(auth)
      .attach('image', Buffer.from('GIF89a....'), { filename: 'c.gif', contentType: 'image/gif' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('assinatura falsa → 400 e nada salvo', async () => {
    const { app, db } = makeApp({ users });
    const combo = await seedCombo(db);
    const res = await request(app).post(url(combo.id)).set(auth)
      .attach('image', Buffer.from('isto não é um png'), { filename: 'c.png', contentType: 'image/png' });
    assert.equal(res.status, 400);
    assert.equal((await db.getCombo(combo.id)).imageUrl, null);
  });

  it('sem arquivo → 400', async () => {
    const { app, db } = makeApp({ users });
    const combo = await seedCombo(db);
    const res = await request(app).post(url(combo.id)).set(auth);
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('combo inexistente → 404 sem subir arquivo', async () => {
    const { app, db } = makeApp({ users });
    let uploads = 0;
    const original = db.uploadComboImage;
    db.uploadComboImage = async (...args) => { uploads += 1; return original(...args); };
    const res = await request(app).post(url(MISSING)).set(auth)
      .attach('image', jpeg(), { filename: 'c.jpg', contentType: 'image/jpeg' });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.message, NOT_FOUND_MSG);
    assert.equal(uploads, 0);
  });
});

describe('produto excluído some das vagas (spec §3.4)', () => {
  it('GET não lista o id apagado e o PUT do combo devolvido passa', async () => {
    const { app, db } = makeApp({ users });
    const combo = await seedCombo(db);
    const del = await request(app).delete(`/api/admin/products/${IDS.marguerita}`).set(auth);
    assert.equal(del.status, 204);

    const list = await request(app).get('/api/admin/combos').set(auth);
    assert.equal(list.status, 200);
    const got = list.body.combos[0];
    assert.ok(!got.slots[0].productIds.includes(IDS.marguerita));
    assert.equal(got.slots[0].productIds.length, 3);

    const body = {
      name: got.name, description: got.description, priceCents: 3990, weekdays: got.weekdays,
      slots: got.slots.map((s) => ({ label: s.label, kind: s.kind, productIds: s.productIds })),
    };
    const put = await request(app).put(`/api/admin/combos/${combo.id}`).set(auth).send(body);
    assert.equal(put.status, 200);
    assert.ok(!put.body.combo.slots[0].productIds.includes(IDS.marguerita));
  });
});
