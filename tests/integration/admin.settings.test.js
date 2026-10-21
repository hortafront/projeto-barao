// PUT/GET /api/admin/settings — override da loja e número do WhatsApp (tela Loja).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp } from '../helpers/testkit.js';

const users = { 'token-dono': { id: 'u1', email: 'dono@barao.com' } };
const auth = { Authorization: 'Bearer token-dono' };

describe('/api/admin/settings', () => {
  it('GET autorizado → 200 com storeOverride, whatsappNumber e updatedAt', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).get('/api/admin/settings').set(auth);
    assert.equal(res.status, 200);
    assert.equal(res.body.storeOverride, 'auto');
    assert.equal(res.body.whatsappNumber, '5585992732247');
    assert.ok('updatedAt' in res.body);
  });

  it('número válido → 200, GET devolve o novo e o banco guarda o novo', async () => {
    const { app, db } = makeApp({ users });
    const put = await request(app).put('/api/admin/settings').set(auth).send({ whatsappNumber: '5585988887777' });
    assert.equal(put.status, 200);
    assert.equal(put.body.whatsappNumber, '5585988887777');
    assert.equal(put.body.storeOverride, 'auto'); // campo não enviado não muda

    const get = await request(app).get('/api/admin/settings').set(auth);
    assert.deepEqual([get.body.storeOverride, get.body.whatsappNumber], ['auto', '5585988887777']);
    assert.equal((await db.getSettings()).whatsappNumber, '5585988887777');
  });

  it('PUT { storeOverride: "closed" } muda só o override e mantém o número', async () => {
    const { app } = makeApp({ users });
    const put = await request(app).put('/api/admin/settings').set(auth).send({ storeOverride: 'closed' });
    assert.equal(put.status, 200);
    assert.equal(put.body.storeOverride, 'closed');
    assert.equal(put.body.whatsappNumber, '5585992732247');
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
    assert.equal((await db.getSettings()).whatsappNumber, '5585992732247');
  });
});
