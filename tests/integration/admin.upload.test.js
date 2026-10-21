// tests/integration/admin.upload.test.js — POST /api/admin/products/:id/image
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, IDS } from '../helpers/testkit.js';

const users = { 'token-dono': { id: 'u1', email: 'dono@barao.com' } };
const auth = { Authorization: 'Bearer token-dono' };
const MISSING = '00000000-0000-4000-8000-999999999999';
const jpeg = (size = 64) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size - 4)]);
const url = (id) => `/api/admin/products/${id}/image`;

describe('POST /api/admin/products/:id/image', () => {
  it('JPEG válido → 200 e imageUrl do bucket', async () => {
    const { app, db } = makeApp({ users });
    const res = await request(app).post(url(IDS.frango)).set(auth)
      .attach('image', jpeg(), { filename: 'f.jpg', contentType: 'image/jpeg' });
    assert.equal(res.status, 200);
    assert.ok(res.body.product.imageUrl.startsWith('https://fake.supabase.co/storage/v1/object/public/product-images/products/'));
    assert.equal((await db.getProductById(IDS.frango)).imageUrl, res.body.product.imageUrl);
  });

  it('image/gif → 400', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).post(url(IDS.frango)).set(auth)
      .attach('image', Buffer.from('GIF89a....'), { filename: 'f.gif', contentType: 'image/gif' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('texto com contentType image/png (assinatura falsa) → 400 e nada salvo', async () => {
    const { app, db } = makeApp({ users });
    const before = (await db.getProductById(IDS.frango)).imageUrl;
    const res = await request(app).post(url(IDS.frango)).set(auth)
      .attach('image', Buffer.from('isto não é um png'), { filename: 'f.png', contentType: 'image/png' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.equal((await db.getProductById(IDS.frango)).imageUrl, before);
  });

  it('2 MB + 1 byte → 413 VALIDATION_ERROR', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).post(url(IDS.frango)).set(auth)
      .attach('image', jpeg(2 * 1024 * 1024 + 1), { filename: 'f.jpg', contentType: 'image/jpeg' });
    assert.equal(res.status, 413);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('sem arquivo → 400', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).post(url(IDS.frango)).set(auth).field('x', 'y');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('produto inexistente → 404', async () => {
    const { app } = makeApp({ users });
    const res = await request(app).post(url(MISSING)).set(auth)
      .attach('image', jpeg(), { filename: 'f.jpg', contentType: 'image/jpeg' });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });
});
