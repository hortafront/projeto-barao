import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileSchema, addressInputSchema } from '../../src/schemas/customer.schema.js';

const msg = (r) => r.error.issues[0].message;
const addr = { street: 'Rua A', number: '10', district: 'Centro' };

test('profileSchema normaliza nome e telefone', () => {
  assert.deepEqual(profileSchema.parse({ name: '  Ana  ', phone: '(85) 99999-9999' }), { name: 'Ana', phone: '85999999999' });
});

test('profileSchema rejeita nome curto, longo e telefone inválido', () => {
  assert.equal(msg(profileSchema.safeParse({ name: 'A', phone: '85999999999' })), 'Informe seu nome.');
  assert.equal(msg(profileSchema.safeParse({ name: 'A'.repeat(61), phone: '85999999999' })), 'O nome deve ter no máximo 60 caracteres.');
  assert.equal(msg(profileSchema.safeParse({ name: 'Ana', phone: '859999999' })), 'Telefone com DDD (10 ou 11 dígitos).');
});

test('addressInputSchema valida apelido, rua, referência e isDefault', () => {
  assert.equal(msg(addressInputSchema.safeParse({ ...addr, label: 'x'.repeat(31) })), 'O apelido deve ter no máximo 30 caracteres.');
  assert.equal(addressInputSchema.parse({ ...addr, label: '' }).label, null);
  assert.equal(msg(addressInputSchema.safeParse({ number: '10', district: 'Centro' })), 'Informe a rua.');
  assert.equal(msg(addressInputSchema.safeParse({ ...addr, reference: 'x'.repeat(121) })), 'A referência deve ter no máximo 120 caracteres.');
  assert.equal(addressInputSchema.safeParse({ ...addr, isDefault: 'sim' }).success, false);
  assert.equal(addressInputSchema.parse(addr).isDefault, undefined);
  assert.equal(addressInputSchema.parse({ ...addr, isDefault: true }).isDefault, true);
});
