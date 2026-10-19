import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { makeApp } from '../helpers/testkit.js';

describe('createApp', () => {
  it('exige db', () => {
    assert.throws(() => createApp({}), { message: 'createApp: db é obrigatório' });
  });

  it('rota /api desconhecida → 404 NOT_FOUND no formato único', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/nao-existe');
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: { code: 'NOT_FOUND', message: 'Não encontramos o que você procurou.' } });
  });

  it('JSON malformado → 400 VALIDATION_ERROR', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/orders').set('Content-Type', 'application/json').send('{"a":');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('corpo JSON de 21 kb → 413 VALIDATION_ERROR', async () => {
    const { app } = makeApp();
    const body = JSON.stringify({ a: 'x'.repeat(21 * 1024) });
    const res = await request(app).post('/api/orders').set('Content-Type', 'application/json').send(body);
    assert.equal(res.status, 413);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('GET /api/admin-config é público e cacheável por 5 minutos', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/admin-config');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { supabaseUrl: 'https://fake.supabase.co', supabaseAnonKey: 'fake-anon-key' });
    assert.equal(res.headers['cache-control'], 'public, max-age=300');
  });

  it('CSP e cabeçalhos de segurança', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/admin-config');
    const csp = res.headers['content-security-policy'];
    assert.ok(csp.includes("frame-ancestors 'none'"));
    assert.ok(csp.includes("script-src 'self' https://cdn.jsdelivr.net"));
    assert.ok(csp.includes("connect-src 'self' https://fake.supabase.co"));
    assert.ok(csp.includes("style-src 'self' https://fonts.googleapis.com"));
    assert.ok(csp.includes("font-src 'self' https://fonts.gstatic.com"));
    assert.ok(csp.includes("img-src 'self' data: https://fake.supabase.co"));
    assert.equal(res.headers['x-powered-by'], undefined);
  });

  it('serve public/ em / e shared/ em /shared', async () => {
    const { app } = makeApp();
    const index = await request(app).get('/');
    assert.equal(index.status, 200);
    assert.match(index.headers['content-type'], /text\/html/);
    const pricing = await request(app).get('/shared/pricing.js');
    assert.equal(pricing.status, 200);
    assert.match(pricing.headers['content-type'], /javascript/);
  });

  it('rate limit do admin: a 301ª requisição → 429 RATE_LIMITED', async () => {
    const { app } = makeApp({ options: { rateLimit: true } });
    for (let i = 0; i < 300; i += 1) {
      const res = await request(app).get('/api/admin/x');
      assert.equal(res.status, 401);
    }
    const res = await request(app).get('/api/admin/x');
    assert.equal(res.status, 429);
    assert.equal(res.body.error.code, 'RATE_LIMITED');
    assert.equal(res.body.error.message, 'Muitas tentativas. Aguarde alguns minutos e tente de novo.');
  });
});
