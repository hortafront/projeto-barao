import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { seedProducts } from '../helpers/fakeDb.js';

const root = new URL('../../', import.meta.url);
// Sem foto fiel disponível: ficam com o placeholder até chegar a foto real.
const NO_PHOTO = ['Carne do Sol', 'Guaraná 1 Litro'];

test('seed: produtos com foto provisória têm arquivo WebP válido; adicionais e NO_PHOTO sem foto', () => {
  for (const p of seedProducts()) {
    if (p.kind === 'addon' || NO_PHOTO.includes(p.name)) { assert.equal(p.imageUrl, null, p.name); continue; }
    assert.match(p.imageUrl ?? '', /^\/img\/products\/[a-z0-9-]+\.webp$/, p.name);
    const buf = fs.readFileSync(new URL(`public${p.imageUrl}`, root));
    assert.equal(buf.subarray(0, 4).toString(), 'RIFF', p.name);
    assert.equal(buf.subarray(8, 12).toString(), 'WEBP', p.name);
    assert.ok(buf.length < 80 * 1024, `${p.name}: ${buf.length} bytes`);
  }
});

test('seed SQL (0002) usa os mesmos image_url do fakeDb (inclusive null)', () => {
  const sql = fs.readFileSync(new URL('supabase/migrations/0002_seed_cardapio.sql', root), 'utf8');
  for (const p of seedProducts()) {
    const row = sql.split('\n').find((l) => l.includes(`'${p.name}'`));
    assert.ok(row, p.name);
    if (p.imageUrl) assert.ok(row.includes(`'${p.imageUrl}'`), p.name);
    else assert.ok(!row.includes('/img/products/') && /null\)\s*,?\s*$/.test(row), `${p.name}: image_url deveria ser null`);
  }
});
