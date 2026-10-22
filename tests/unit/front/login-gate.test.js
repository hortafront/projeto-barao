import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../helpers/browserAliases.js';

const { createLoginGate, needsProfile } = await import('../../../public/js/login-gate.js');

const ME = { email: 'a@b.com', profile: { name: 'Ana', phone: '85999990000' }, addresses: [] };
const NO_PROFILE = { email: 'a@b.com', profile: null, addresses: [] };

function setup(over = {}) {
  const calls = { openLogin: 0, loadMe: 0, openCompleteProfile: 0 };
  const gate = createLoginGate({
    getSession: async () => ({ access_token: 't' }),
    loadMe: async () => { calls.loadMe += 1; return ME; },
    openLogin: async () => { calls.openLogin += 1; return true; },
    openCompleteProfile: async () => { calls.openCompleteProfile += 1; return ME; },
    ...over,
  });
  return { gate, calls };
}

test('needsProfile: só quando o perfil é null', () => {
  assert.equal(needsProfile(NO_PROFILE), true);
  assert.equal(needsProfile(ME), false);
});

test('com sessão e perfil: ação roda 1x com me, sem abrir o login', async () => {
  const { gate, calls } = setup();
  const seen = [];
  const ok = await gate.run((me) => { seen.push(me); });
  assert.equal(ok, true);
  assert.deepEqual(seen, [ME]);
  assert.equal(calls.openLogin, 0);
});

test('sem sessão e login ok: carrega me e roda a ação 1x', async () => {
  let session = null;
  const { gate, calls } = setup({
    getSession: async () => session,
    openLogin: async () => { session = { access_token: 't' }; return true; },
  });
  let ran = 0;
  assert.equal(await gate.run(() => { ran += 1; }), true);
  assert.equal(ran, 1);
  assert.equal(calls.loadMe, 1);
});

test('login cancelado: ação não roda e a antiga não vaza no run seguinte', async () => {
  let session = null;
  let accept = false;
  const { gate } = setup({
    getSession: async () => session,
    openLogin: async () => { if (accept) session = { access_token: 't' }; return accept; },
  });
  const ran = [];
  assert.equal(await gate.run(() => ran.push('antiga')), false);
  assert.deepEqual(ran, []);
  accept = true;
  assert.equal(await gate.run(() => ran.push('nova')), true);
  assert.deepEqual(ran, ['nova']);
});

test('perfil ausente: completa antes e a ação recebe o me atualizado', async () => {
  const { gate, calls } = setup({ loadMe: async () => NO_PROFILE });
  const seen = [];
  assert.equal(await gate.run((me) => { seen.push(me); }), true);
  assert.equal(calls.openCompleteProfile, 1);
  assert.deepEqual(seen, [ME]);
});

test('perfil ausente e janela fechada (null): ação não roda', async () => {
  const { gate } = setup({ loadMe: async () => NO_PROFILE, openCompleteProfile: async () => null });
  let ran = 0;
  assert.equal(await gate.run(() => { ran += 1; }), false);
  assert.equal(ran, 0);
});

test('loadMe null (rede): ação não roda e run resolve false', async () => {
  const { gate } = setup({ loadMe: async () => null });
  let ran = 0;
  assert.equal(await gate.run(() => { ran += 1; }), false);
  assert.equal(ran, 0);
});

test('dois run simultâneos sem sessão: openLogin 1x', async () => {
  let session = null;
  let release;
  const gateOpen = new Promise((r) => { release = r; });
  const { gate, calls } = setup({
    getSession: async () => session,
    openLogin: async () => { calls.openLogin += 1; await gateOpen; session = { access_token: 't' }; return true; },
  });
  let ran = 0;
  const a = gate.run(() => { ran += 1; });
  const b = gate.run(() => { ran += 1; });
  await new Promise((r) => setTimeout(r, 5));
  release();
  assert.deepEqual(await Promise.all([a, b]), [true, true]);
  assert.equal(calls.openLogin, 1);
  assert.equal(ran, 2);
});
