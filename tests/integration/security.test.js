import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { makeApp } from '../helpers/testkit.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}
const files = walk(PUBLIC_DIR);
const byExt = (ext) => files.filter((f) => f.endsWith(ext));
const rel = (f) => path.relative(PUBLIC_DIR, f).split(path.sep).join('/');

function cspMap(header) {
  return Object.fromEntries(header.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const [name, ...values] = d.split(/\s+/);
    return [name, values];
  }));
}

test('CSP: cada diretiva do spec §13', async () => {
  const { app } = makeApp();
  const res = await request(app).get('/api/status');
  const csp = cspMap(res.headers['content-security-policy']);
  assert.deepEqual(csp['default-src'], ["'self'"]);
  assert.deepEqual(csp['script-src'], ["'self'", 'https://cdn.jsdelivr.net']);
  assert.deepEqual(csp['style-src'], ["'self'", 'https://fonts.googleapis.com']);
  assert.deepEqual(csp['font-src'], ["'self'", 'https://fonts.gstatic.com']);
  assert.deepEqual(csp['img-src'], ["'self'", 'data:', 'blob:', 'https://fake.supabase.co']);
  assert.deepEqual(csp['connect-src'], ["'self'", 'https://fake.supabase.co']);
  assert.deepEqual(csp['frame-ancestors'], ["'none'"]);
  assert.deepEqual(csp['object-src'], ["'none'"]);
  assert.deepEqual(csp['form-action'], ["'self'"]);
});

test('CORS: origem estranha não é liberada; CORS_ORIGIN é ecoada', async () => {
  const { app } = makeApp();
  const evil = await request(app).get('/api/status').set('Origin', 'https://evil.example');
  assert.equal(evil.headers['access-control-allow-origin'], undefined);
  const ok = await request(app).get('/api/status').set('Origin', 'http://localhost:3000');
  assert.equal(ok.headers['access-control-allow-origin'], 'http://localhost:3000');
});

test('trustProxy: options.trustProxy vira trust proxy do Express', () => {
  assert.equal(makeApp({ options: { trustProxy: 1 } }).app.get('trust proxy'), 1);
  assert.equal(makeApp().app.get('trust proxy'), false);
});

test('estáticos: /shared/pricing.js com no-cache e JS', async () => {
  const { app } = makeApp();
  const res = await request(app).get('/shared/pricing.js');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/javascript/);
  assert.equal(res.headers['cache-control'], 'no-cache');
});

test('estáticos: /js e /css com no-cache (evita módulos misturados após deploy); /img com max-age=3600; HTML com no-cache', async () => {
  const { app } = makeApp();
  for (const url of ['/js/dom.js', '/css/tokens.css']) {
    const res = await request(app).get(url);
    assert.equal(res.status, 200, url);
    assert.match(res.headers['cache-control'], /^no-cache$/, url);
  }
  const img = files.find((f) => rel(f).startsWith('img/'));
  if (img) {
    const res = await request(app).get('/' + rel(img));
    assert.match(res.headers['cache-control'], /max-age=3600/);
  }
  for (const url of ['/', '/admin/index.html', '/admin/painel.html']) {
    const res = await request(app).get(url);
    assert.equal(res.status, 200, url);
    assert.equal(res.headers['cache-control'], 'no-cache', url);
  }
});

test('varredura: HTML sem <script> inline, style="" nem on*=', () => {
  const htmls = byExt('.html');
  assert.ok(htmls.length >= 3);
  for (const f of htmls) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/<script\b([^>]*)>/gi)) {
      assert.match(m[1], /\bsrc\s*=/, `${rel(f)}: <script> sem src`);
    }
    assert.doesNotMatch(src, /\sstyle\s*=/i, `${rel(f)}: style=""`);
    assert.doesNotMatch(src, /<[a-z][^>]*\son[a-z]+\s*=/i, `${rel(f)}: atributo on*=`);
  }
});

test('varredura: JS do front sem innerHTML/insertAdjacentHTML/outerHTML (exceto guarda do dom.js)', () => {
  for (const f of byExt('.js')) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/innerHTML|insertAdjacentHTML|outerHTML/.test(line)) return;
      if (/^\s*(\/\/|\/\*|\*)/.test(line)) return; // só comentário, não é uso
      assert.ok(rel(f) === 'js/dom.js', `${rel(f)}:${i + 1}: ${line.trim()}`);
    });
  }
});

test('varredura: public/ sem SERVICE_ROLE nem número do WhatsApp', () => {
  for (const f of files) {
    if (/\.(png|jpe?g|webp|ico|woff2?)$/i.test(f)) continue;
    const src = fs.readFileSync(f, 'utf8');
    assert.ok(!src.includes('SERVICE_ROLE'), `${rel(f)}: SERVICE_ROLE`);
    assert.ok(!src.includes('5585992732247'), `${rel(f)}: número do WhatsApp`);
  }
});
