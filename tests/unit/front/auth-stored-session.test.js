import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../helpers/browserAliases.js';

const { hasStoredSession } = await import('../../../public/js/auth.js');
const { CUSTOMER_STORAGE_KEY } = await import('../../../public/js/customer-api.js');

test('hasStoredSession: chave ausente -> false', () => {
  assert.equal(hasStoredSession({ getItem: () => null }), false);
});

test('hasStoredSession: chave presente -> true (lê a chave da sessão do cliente)', () => {
  const asked = [];
  const storage = { getItem: (k) => { asked.push(k); return '{"access_token":"x"}'; } };
  assert.equal(hasStoredSession(storage), true);
  assert.deepEqual(asked, [CUSTOMER_STORAGE_KEY]);
});

test('hasStoredSession: storage que lança ou ausente -> false', () => {
  assert.equal(hasStoredSession({ getItem: () => { throw new Error('blocked'); } }), false);
  assert.equal(hasStoredSession(undefined), false);
});
