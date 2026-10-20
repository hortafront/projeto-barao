// GET/PUT /api/admin/hours — horários semanais (turno que vira a meia-noite).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp } from '../helpers/testkit.js';
import { getStoreStatus } from '../../src/services/hours.service.js';

const users = { 'token-dono': { id: 'u1', email: 'dono@barao.com' } };
const auth = { Authorization: 'Bearer token-dono' };

describe('/api/admin/hours', () => {
  it('GET → 7 itens ordenados por weekday, terça fechada', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).get('/api/admin/hours').set(auth);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.hours.map((h) => h.weekday), [0, 1, 2, 3, 4, 5, 6]);
    assert.equal(res.body.hours[2].isClosed, true);
  });

  it('PUT sexta 18:00→00:30 → 200 e a loja fica aberta sáb 00:10', async () => {
    const { app, db } = makeApp({ users });
    const hours = (await request(app).get('/api/admin/hours').set(auth)).body.hours;
    const next = hours.map((h) => (h.weekday === 5 ? { ...h, opensAt: '18:00', closesAt: '00:30', isClosed: false } : h));
    const res = await request(app).put('/api/admin/hours').set(auth).send(next);
    assert.equal(res.status, 200);
    assert.equal(res.body.hours.find((h) => h.weekday === 5).closesAt, '00:30');
    assert.equal(getStoreStatus(new Date('2026-10-24T03:10:00Z'), db.state.hours).open, true);
  });

  it('PUT fora de ordem volta ordenado', async () => {
    const { app } = makeApp({ users });
    const hours = (await request(app).get('/api/admin/hours').set(auth)).body.hours;
    const res = await request(app).put('/api/admin/hours').set(auth).send([...hours].reverse());
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.hours.map((h) => h.weekday), [0, 1, 2, 3, 4, 5, 6]);
  });

  it('6 dias, weekday repetido ou "25:00" → 400 VALIDATION_ERROR e horários inalterados', async () => {
    const { app, db } = makeApp({ users });
    const before = JSON.stringify(db.state.hours);
    const hours = (await request(app).get('/api/admin/hours').set(auth)).body.hours;
    const bad = [
      hours.slice(0, 6),
      hours.map((h, i) => (i === 6 ? { ...h, weekday: 0 } : h)),
      hours.map((h, i) => (i === 0 ? { ...h, closesAt: '25:00' } : h)),
    ];
    for (const body of bad) {
      const res = await request(app).put('/api/admin/hours').set(auth).send(body);
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    }
    assert.equal(JSON.stringify(db.state.hours), before);
  });
});
