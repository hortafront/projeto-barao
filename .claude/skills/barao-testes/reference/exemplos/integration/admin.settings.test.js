// tests/integration/admin.settings.test.js — PUT /api/admin/settings: número do WhatsApp alterado pelo painel (tela Loja).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, validOrder } from '../helpers/testkit.js';

const users = { 'token-dono': { id: 'u1', email: 'dono@barao.com' } };
const auth = { Authorization: 'Bearer token-dono' };

describe('PUT /api/admin/settings — whatsappNumber', () => {
  it('número válido → 200, GET devolve o novo e o próximo pedido usa no whatsappUrl', async () => {
    const { app } = makeApp({ users });
    const put = await request(app).put('/api/admin/settings').set(auth).send({ whatsappNumber: '5585988887777' });
    assert.equal(put.status, 200);
    assert.equal(put.body.whatsappNumber, '5585988887777');
    assert.equal(put.body.storeOverride, 'auto'); // campo não enviado não muda

    const get = await request(app).get('/api/admin/settings').set(auth);
    assert.equal(get.status, 200);
    assert.deepEqual([get.body.storeOverride, get.body.whatsappNumber], ['auto', '5585988887777']);

    const order = await request(app).post('/api/orders').send(validOrder());
    assert.equal(order.status, 201);
    assert.ok(order.body.whatsappUrl.startsWith('https://wa.me/5585988887777?text='), order.body.whatsappUrl);
  });

  it('número inválido (máscara, sem 55, curto/longo) ou corpo vazio → 400 VALIDATION_ERROR e nada muda', async () => {
    const { app, db } = makeApp({ users });
    for (const whatsappNumber of ['(85) 98888-7777', '85988887777', '558598888', '55859888877770', '1185988887777']) {
      const res = await request(app).put('/api/admin/settings').set(auth).send({ whatsappNumber });
      assert.equal(res.status, 400, whatsappNumber);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      assert.ok(res.body.error.details.some((d) => d.path === 'whatsappNumber'), whatsappNumber);
    }
    const empty = await request(app).put('/api/admin/settings').set(auth).send({});
    assert.equal(empty.status, 400);
    assert.equal((await db.getSettings()).whatsappNumber, '5585997687641');
  });
});
