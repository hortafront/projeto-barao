import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, bearer, postOrder, validOrder, CUSTOMER_A, CUSTOMER_B, CUSTOMER_NEW } from '../helpers/testkit.js';

const ADDR = { street: 'Rua X', number: '123', district: 'Centro', reference: 'perto da praça' };
const UNAUTH = 'Entre na sua conta para continuar.';
const ID = '00000000-0000-4000-8000-000000000999';

test('as 7 rotas sem token → 401 UNAUTHORIZED', async () => {
  const { app } = makeApp();
  const calls = [
    ['get', '/api/me'], ['put', '/api/me'], ['post', '/api/me/addresses'],
    ['put', `/api/me/addresses/${ID}`], ['delete', `/api/me/addresses/${ID}`],
    ['patch', `/api/me/addresses/${ID}/default`], ['delete', '/api/me'],
  ];
  for (const [m, url] of calls) {
    const res = await request(app)[m](url).send({});
    assert.equal(res.status, 401, `${m} ${url}`);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
    assert.equal(res.body.error.message, UNAUTH);
  }
});

test('GET /api/me devolve e-mail, perfil e endereços', async () => {
  const { app } = makeApp();
  const res = await request(app).get('/api/me').set(bearer(CUSTOMER_A));
  assert.equal(res.status, 200);
  assert.equal(res.body.email, 'joao@cliente.com');
  assert.deepEqual(res.body.profile, { name: 'João Silva', phone: '85999999999' });
  assert.deepEqual(res.body.addresses, []);
  const novo = await request(app).get('/api/me').set(bearer(CUSTOMER_NEW));
  assert.equal(novo.body.profile, null);
});

test('PUT /api/me salva o perfil com telefone normalizado', async () => {
  const { app } = makeApp();
  const res = await request(app).put('/api/me').set(bearer(CUSTOMER_NEW)).send({ name: 'Novo Cliente', phone: '(85) 98888-7777' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { profile: { name: 'Novo Cliente', phone: '85988887777' } });
  const bad = await request(app).put('/api/me').set(bearer(CUSTOMER_NEW)).send({ name: 'A', phone: '85988887777' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'VALIDATION_ERROR');
  assert.equal(bad.body.error.stack, undefined);
});

test('CRUD de endereços: padrão, edição, troca de padrão e exclusão', async () => {
  const { app } = makeApp();
  const as = (m, url) => request(app)[m](url).set(bearer(CUSTOMER_A));
  const a1 = await as('post', '/api/me/addresses').send(ADDR);
  assert.equal(a1.status, 201);
  assert.equal(a1.body.address.isDefault, true);
  const a2 = await as('post', '/api/me/addresses').send({ ...ADDR, street: 'Rua Y' });
  assert.equal(a2.body.address.isDefault, false);
  const a3 = await as('post', '/api/me/addresses').send({ ...ADDR, street: 'Rua Z' });

  const put = await as('put', `/api/me/addresses/${a2.body.address.id}`).send({ ...ADDR, street: 'Rua Nova' });
  assert.equal(put.status, 200);
  assert.equal(put.body.address.street, 'Rua Nova');

  const def = await as('patch', `/api/me/addresses/${a3.body.address.id}/default`);
  assert.equal(def.status, 200);
  assert.equal(def.body.address.isDefault, true);
  let list = (await as('get', '/api/me')).body.addresses;
  assert.equal(list.filter((a) => a.isDefault).length, 1);
  assert.equal(list[0].id, a3.body.address.id);

  // isDefault:false no padrão não o remove
  const keep = await as('put', `/api/me/addresses/${a3.body.address.id}`).send({ ...ADDR, isDefault: false });
  assert.equal(keep.body.address.isDefault, true);

  // apagar o padrão → o mais recente restante (a2) vira padrão
  const del = await as('delete', `/api/me/addresses/${a3.body.address.id}`);
  assert.equal(del.status, 204);
  list = (await as('get', '/api/me')).body.addresses;
  assert.equal(list.length, 2);
  assert.equal(list[0].isDefault, true);
  assert.equal(list.filter((a) => a.isDefault).length, 1);
  assert.equal(list[0].id, a2.body.address.id);
});

test('limites: 11º endereço e perfil incompleto → 400', async () => {
  const { app } = makeApp();
  for (let i = 0; i < 10; i += 1) {
    const r = await request(app).post('/api/me/addresses').set(bearer(CUSTOMER_A)).send(ADDR);
    assert.equal(r.status, 201);
  }
  const over = await request(app).post('/api/me/addresses').set(bearer(CUSTOMER_A)).send(ADDR);
  assert.equal(over.status, 400);
  assert.equal(over.body.error.message, 'Você pode salvar até 10 endereços.');
  const noProfile = await request(app).post('/api/me/addresses').set(bearer(CUSTOMER_NEW)).send(ADDR);
  assert.equal(noProfile.status, 400);
  assert.equal(noProfile.body.error.message, 'Complete seu perfil antes de salvar endereços.');
});

test('cliente B não mexe em endereço de A (404) e id malformado → 400', async () => {
  const { app } = makeApp();
  const a = (await request(app).post('/api/me/addresses').set(bearer(CUSTOMER_A)).send(ADDR)).body.address;
  const b = (m, url) => request(app)[m](url).set(bearer(CUSTOMER_B));
  for (const res of [
    await b('put', `/api/me/addresses/${a.id}`).send({ ...ADDR, street: 'Invadida' }),
    await b('delete', `/api/me/addresses/${a.id}`),
    await b('patch', `/api/me/addresses/${a.id}/default`),
  ]) {
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  }
  const after = (await request(app).get('/api/me').set(bearer(CUSTOMER_A))).body.addresses;
  assert.deepEqual(after, [a]);
  assert.equal((await b('delete', '/api/me/addresses/abc')).status, 400);
  assert.equal((await b('put', '/api/me/addresses/abc').send(ADDR)).status, 400);
  assert.equal((await b('patch', '/api/me/addresses/abc/default')).status, 400);
});

test('DELETE /api/me apaga a conta e desvincula os pedidos', async () => {
  const { app, db } = makeApp();
  const order = await postOrder(app, validOrder(), { customer: CUSTOMER_A });
  assert.equal(order.status, 201);
  assert.equal(db.state.orders[0].customerId, CUSTOMER_A.id);
  const del = await request(app).delete('/api/me').set(bearer(CUSTOMER_A));
  assert.equal(del.status, 204);
  const after = await request(app).get('/api/me').set(bearer(CUSTOMER_A));
  assert.equal(after.status, 401);
  assert.equal(db.state.orders[0].customerId, null);
});

test('e-mail de ADMIN_EMAILS também é cliente', async () => {
  const { app } = makeApp({ users: { 'token-dono': { id: '00000000-0000-4000-8000-0000000000d1', email: 'dono@barao.com' } } });
  const res = await request(app).get('/api/me').set({ Authorization: 'Bearer token-dono' });
  assert.equal(res.status, 200);
  assert.equal(res.body.profile, null);
});

test('erros nunca expõem stack', async () => {
  const { app } = makeApp();
  const res = await request(app).put('/api/me/addresses/abc').set(bearer(CUSTOMER_A)).send({});
  assert.equal(res.status, 400);
  assert.equal(JSON.stringify(res.body).includes('stack'), false);
});
