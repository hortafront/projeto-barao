import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../../src/db/repositories/index.js';
import { createFakeDb } from '../helpers/fakeDb.js';

test('repositório Supabase expõe exatamente os métodos da interface db', () => {
  const stubSupabase = { from() {}, rpc() {}, storage: {}, auth: {} };
  assert.deepEqual(
    Object.keys(createRepository(stubSupabase)).sort(),
    Object.keys(createFakeDb()).filter((k) => k !== 'state').sort(),
  );
});
