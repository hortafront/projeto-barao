// tests/integration/admin.auth.test.js — requireAdmin em todas as rotas /api/admin/*.
// A verificação do token é "mockada" pelo fakeDb: getUserByAccessToken(token) (auth.repo.js no real
// envolve supabase.auth.getUser(token)). Nenhuma chamada ao Supabase de verdade.
// E-mails autorizados entram por createApp({ options: { adminEmails } }) — testkit usa ADMIN_EMAILS de teste.
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
    });
  }

  it('token inválido/expirado → 401', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).get('/api/admin/products').set('Authorization', 'Bearer token-falso');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
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
  });

  it('e-mail autorizado (comparação sem diferenciar maiúsculas) → 200', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).get('/api/admin/products').set('Authorization', 'Bearer token-dono');
    assert.equal(res.status, 200);
  });

  it('lista vinda do env com espaços/maiúsculas também funciona', async () => {
    const adminEmails = ' DONO@barao.com , gerente@barao.com'.split(','); // como process.env.ADMIN_EMAILS.split(',')
    const { app } = makeApp({ users, options: { adminEmails } });
    const res = await request(app).get('/api/admin/products').set('Authorization', 'Bearer token-dono');
    assert.equal(res.status, 200);
  });

  it('ADMIN_EMAILS vazio → ninguém entra (403)', async () => {
    const { app } = makeApp({ users, options: { adminEmails: [''] } });
    const res = await request(app).get('/api/admin/products').set('Authorization', 'Bearer token-dono');
    assert.equal(res.status, 403);
  });

  it('admin autorizado consegue marcar produto como esgotado', async () => {
    const { app, db } = makeApp({ users });
    const res = await request(app)
      .patch(`/api/admin/products/${IDS.frango}/availability`)
      .set('Authorization', 'Bearer token-dono')
      .send({ available: false });
    assert.equal(res.status, 200);
    assert.equal((await db.getProductById(IDS.frango)).available, false);
  });

  it('rotas públicas continuam sem exigir token', async () => {
    const { app } = makeApp({ users });
    assert.equal((await request(app).get('/api/menu')).status, 200);
    assert.equal((await request(app).get('/api/status')).status, 200);
  });
});
