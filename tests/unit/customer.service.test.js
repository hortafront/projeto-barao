import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb } from '../helpers/fakeDb.js';
import { fixedNow, SUNDAY_20H } from '../helpers/clock.js';
import { AppError } from '../../src/errors/AppError.js';
import {
  MAX_ADDRESSES, getAccount, saveProfile, addAddress, editAddress, removeAddress, makeDefaultAddress, deleteAccount,
} from '../../src/services/customer.service.js';

const U = '00000000-0000-4000-8000-0000000000a1';
const V = '00000000-0000-4000-8000-0000000000b1';
const profile = { name: 'João Silva', phone: '85999999999' };
const addr = (street, extra = {}) => ({ label: null, street, number: '1', district: 'Centro', reference: null, ...extra });
const mk = (customers = { [U]: profile, [V]: { name: 'Maria', phone: '85988888888' } }) =>
  createFakeDb({ now: fixedNow(SUNDAY_20H), customers });

const rejectsApp = (p, code, status, message) => assert.rejects(p, (e) => {
  assert.ok(e instanceof AppError);
  assert.equal(e.code, code);
  assert.equal(e.status, status);
  assert.equal(e.message, message);
  return true;
});

test('MAX_ADDRESSES é 10', () => assert.equal(MAX_ADDRESSES, 10));

test('getAccount sem perfil devolve profile null e lista vazia', async () => {
  const db = mk({});
  assert.deepEqual(await getAccount(db, { id: U, email: 'a@b.com' }), { email: 'a@b.com', profile: null, addresses: [] });
});

test('getAccount com perfil devolve perfil e endereços', async () => {
  const db = mk();
  await addAddress(db, U, addr('Rua A'));
  const acc = await getAccount(db, { id: U, email: 'a@b.com' });
  assert.deepEqual(acc.profile, profile);
  assert.equal(acc.addresses.length, 1);
});

test('saveProfile grava e devolve name/phone', async () => {
  const db = mk({});
  assert.deepEqual(await saveProfile(db, U, profile), profile);
  assert.deepEqual(await db.getCustomer(U), profile);
});

test('addAddress sem perfil -> 400', async () => {
  const db = mk({});
  await rejectsApp(addAddress(db, U, addr('Rua A')), 'VALIDATION_ERROR', 400, 'Complete seu perfil antes de salvar endereços.');
});

test('1º endereço vira padrão; 2º com isDefault false não', async () => {
  const db = mk();
  const a = await addAddress(db, U, addr('Rua A', { isDefault: false }));
  assert.equal(a.isDefault, true);
  const b = await addAddress(db, U, addr('Rua B', { isDefault: false }));
  assert.equal(b.isDefault, false);
});

test('11º endereço -> 400 e continua com 10', async () => {
  const db = mk();
  for (let i = 0; i < 10; i++) await addAddress(db, U, addr(`Rua ${i}`));
  await rejectsApp(addAddress(db, U, addr('Rua X')), 'VALIDATION_ERROR', 400, 'Você pode salvar até 10 endereços.');
  assert.equal((await db.listAddresses(U)).length, 10);
});

test('edit/remove/makeDefault de id alheio ou inexistente -> 404', async () => {
  const db = mk();
  const mine = await addAddress(db, V, addr('Rua V'));
  const ghost = '00000000-0000-4000-8000-000000000999';
  for (const id of [mine.id, ghost]) {
    await rejectsApp(editAddress(db, U, id, addr('Z')), 'NOT_FOUND', 404, 'Endereço não encontrado.');
    await rejectsApp(removeAddress(db, U, id), 'NOT_FOUND', 404, 'Endereço não encontrado.');
    await rejectsApp(makeDefaultAddress(db, U, id), 'NOT_FOUND', 404, 'Endereço não encontrado.');
  }
});

test('editAddress, makeDefaultAddress e removeAddress do próprio endereço', async () => {
  const db = mk();
  const a = await addAddress(db, U, addr('Rua A'));
  const b = await addAddress(db, U, addr('Rua B'));
  assert.equal((await editAddress(db, U, b.id, addr('Rua B2'))).street, 'Rua B2');
  assert.equal((await makeDefaultAddress(db, U, b.id)).isDefault, true);
  assert.equal(await removeAddress(db, U, a.id), undefined);
});

test('remover o único endereço e adicionar outro -> o novo é padrão', async () => {
  const db = mk();
  const a = await addAddress(db, U, addr('Rua A'));
  await removeAddress(db, U, a.id);
  assert.equal((await addAddress(db, U, addr('Rua B'))).isDefault, true);
});

test('deleteAccount apaga perfil e endereços', async () => {
  const db = mk();
  await addAddress(db, U, addr('Rua A'));
  assert.equal(await deleteAccount(db, U), undefined);
  assert.equal(await db.getCustomer(U), null);
  assert.deepEqual(await db.listAddresses(U), []);
});
