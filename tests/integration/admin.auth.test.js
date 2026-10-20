// requireAdmin em todas as rotas /api/admin/*. Token "mockado" pelo fakeDb (getUserByAccessToken).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, IDS } from '../helpers/testkit.js';

const users = {
  'token-dono': { id: 'u1', email: 'Dono@Barao.COM' }, // maiúsculas de propósito
  'token-intruso': { id: 'u2', email: 'curioso@gmail.com' },
};

const protectedRoutes = [
  ['get', '/api/admin/products'],
  ['patch', `/api/admin/products/${IDS.frango}/availability`],
  ['get', '/api/admin/hours'],
  ['put', '/api/admin/settings'],
  ['get', '/api/admin/orders?from=2026-10-18&to=2026-10-18'],
  ['get', '/api/admin/reports/summary?from=2026-10-18&to=2026-10-18'],
];

describe('rotas admin — autenticação', () => {
  for (const [method, path] of protectedRoutes) {
    it(`${method.toUpperCase()} ${path} sem token → 401 UNAUTHORIZED`, async () => {
      const { app } = makeApp({ users });
      const res = await request(app)[method](path);
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'UNAUTHORIZED');
      assert.equal(res.body.error.message, 'Sua sessão expirou. Entre novamente.');
    });
  }

  it('token inválido/expirado → 401', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).get('/api/admin/products').set('Authorization', 'Bearer token-falso');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
    assert.equal(res.body.error.message, 'Sua sessão expirou. Entre novamente.');
  });

  it('header sem "Bearer " → 401', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).get('/api/admin/products').set('Authorization', 'token-dono');
    assert.equal(res.status, 401);
  });

  it('token válido de e-mail não autorizado → 403 FORBIDDEN', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).get('/api/admin/products').set('Authorization', 'Bearer token-intruso');
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.equal(res.body.error.message, 'Você não tem permissão para acessar esta área.');
  });

  it('autorizado (e-mail sem diferenciar maiúsculas) passa do requireAdmin', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).get('/api/admin/qualquer').set('Authorization', 'Bearer token-dono');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  it('autorizado passa do requireAdmin com lista do env com espaços/maiúsculas', async () => {
    const adminEmails = ' DONO@barao.com , gerente@barao.com'.split(','); // como process.env.ADMIN_EMAILS.split(',')
    const { app } = makeApp({ users, options: { adminEmails } });
    const res = await request(app).get('/api/admin/qualquer').set('Authorization', 'Bearer token-dono');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  it('ADMIN_EMAILS vazio → ninguém entra (403)', async () => {
    const { app } = makeApp({ users, options: { adminEmails: [''] } });
    const res = await request(app).get('/api/admin/products').set('Authorization', 'Bearer token-dono');
    assert.equal(res.status, 403);
  });
});
