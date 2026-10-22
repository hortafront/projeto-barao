import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../helpers/browserAliases.js';
import { IDS } from '../../helpers/fakeDb.js';
import { createOrderSchema } from '../../../src/schemas/order.schema.js';

const {
  onlyDigits, maskPhone, FieldError, buildOrderPayload, fieldErrorsFromDetails, createOrderSubmitter,
} = await import('../../../public/js/order-payload.js');

const items = [{ kind: 'pizza', flavorIds: [IDS.calabresa], addonIds: [], quantity: 1, notes: '' }];
const base = (extra = {}) => ({
  name: ' Maria Silva ', phone: '(85) 99999-9999', fulfillment: 'pickup', payment: 'pix',
  street: '', number: '', district: '', reference: '', changeFor: '', notes: '', ...extra,
});
const failure = (fn) => { try { fn(); } catch (e) { return e; } return null; };

test('onlyDigits e maskPhone', () => {
  assert.equal(onlyDigits('(85) 9'), '859');
  assert.equal(maskPhone('85999999999'), '(85) 99999-9999');
  assert.equal(maskPhone('8532221111'), '(85) 3222-1111');
  assert.equal(maskPhone(''), '');
  assert.equal(maskPhone('8'), '(8');
});

test('retirada: sem address; telefone só dígitos; notes vazio omitido', () => {
  const body = buildOrderPayload(base(), items, 5949);
  assert.equal('address' in body, false);
  assert.equal('notes' in body, false);
  assert.deepEqual(body.customer, { name: 'Maria Silva', phone: '85999999999' });
  assert.deepEqual(body.payment, { method: 'pix' });
  assert.equal(body.fulfillment, 'pickup');
  assert.deepEqual(body.items, items);
});

test('entrega com rua vazia lança FieldError(street)', () => {
  const err = failure(() => buildOrderPayload(base({ fulfillment: 'delivery', number: '10', district: 'Centro' }), items, 5949));
  assert.ok(err instanceof FieldError);
  assert.equal(err.field, 'street');
});

test('entrega completa inclui address', () => {
  const body = buildOrderPayload(base({
    fulfillment: 'delivery', street: ' Rua A ', number: '10', district: 'Centro', reference: '', notes: ' sem cebola ',
  }), items, 5949);
  assert.deepEqual(body.address, { street: 'Rua A', number: '10', district: 'Centro', reference: '' });
  assert.equal(body.notes, 'sem cebola');
});

test('troco: pix ignora; cash converte; menor que total e inválido erram', () => {
  assert.equal('changeForCents' in buildOrderPayload(base({ changeFor: '100' }), items, 5949).payment, false);
  assert.equal(buildOrderPayload(base({ payment: 'cash', changeFor: '100' }), items, 5949).payment.changeForCents, 10000);
  assert.equal('changeForCents' in buildOrderPayload(base({ payment: 'cash' }), items, 5949).payment, false);
  const low = failure(() => buildOrderPayload(base({ payment: 'cash', changeFor: '50' }), items, 5949));
  assert.ok(low instanceof FieldError);
  assert.equal(low.field, 'changeFor');
  assert.equal(low.message, 'O troco deve ser maior ou igual ao total.');
  const bad = failure(() => buildOrderPayload(base({ payment: 'cash', changeFor: 'abc' }), items, 5949));
  assert.ok(bad instanceof FieldError);
  assert.equal(bad.field, 'changeFor');
});

test('payload passa em createOrderSchema (entrega e retirada)', () => {
  const real = [{ kind: 'pizza', flavorIds: [IDS.calabresa], addonIds: [], quantity: 2, notes: '' }];
  const delivery = buildOrderPayload(base({
    fulfillment: 'delivery', payment: 'cash', changeFor: '100,00', street: 'Rua A', number: '10', district: 'Centro',
  }), real, 5949);
  assert.equal(createOrderSchema.safeParse(delivery).success, true);
  assert.equal(createOrderSchema.safeParse(buildOrderPayload(base(), real, 5949)).success, true);
});

test('fieldErrorsFromDetails mapeia paths para campos (primeiro erro de cada campo vence)', () => {
  assert.deepEqual(fieldErrorsFromDetails([{ path: 'customer.phone', message: 'm' }]), { phone: 'm' });
  assert.deepEqual(fieldErrorsFromDetails([
    { path: 'address.street', message: 'a' }, { path: 'customer.name', message: 'b' },
    { path: 'payment.changeForCents', message: 'c' }, { path: 'items.0.quantity', message: 'd' },
    { path: 'customer.phone', message: 'e' }, { path: 'customer.phone', message: 'f' },
  ]), { street: 'a', name: 'b', changeFor: 'c', items: 'd', phone: 'e' });
  assert.deepEqual(fieldErrorsFromDetails(undefined), {});
});

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test('createOrderSubmitter ignora o segundo envio enquanto o primeiro está pendente', async () => {
  const d = deferred();
  let calls = 0; let ok = 0; let err = 0;
  const submitter = createOrderSubmitter({
    createOrder: () => { calls += 1; return d.promise; },
    onSuccess: () => { ok += 1; }, onError: () => { err += 1; },
  });
  const first = submitter.submit({});
  const second = submitter.submit({});
  assert.equal(calls, 1);
  assert.equal(submitter.pending, true);
  d.resolve({ ok: true, status: 201, data: {} });
  await Promise.all([first, second]);
  assert.equal(ok, 1);
  assert.equal(err, 0);
  assert.equal(submitter.pending, false);
});

test('createOrderSubmitter: falha chama onError e libera novo envio', async () => {
  let calls = 0; let err = 0;
  const submitter = createOrderSubmitter({
    createOrder: async () => { calls += 1; return { ok: false, error: { code: 'NETWORK' } }; },
    onSuccess: () => assert.fail('não deveria'),
    onError: (e) => { err += 1; assert.equal(e.code, 'NETWORK'); },
  });
  await submitter.submit({});
  assert.equal(err, 1);
  assert.equal(submitter.pending, false);
  await submitter.submit({});
  assert.equal(calls, 2);
});

test('createOrderSubmitter compartilhado: segundo submit devolve a mesma promessa em voo (1 POST)', async () => {
  const d = deferred();
  let calls = 0;
  const submitter = createOrderSubmitter({
    createOrder: () => { calls += 1; return d.promise; },
    onSuccess: () => {}, onError: () => {},
  });
  // simula dois "formulários" (ex.: checkout reaberto) usando o mesmo submitter
  const first = submitter.submit({ form: 1 });
  const second = submitter.submit({ form: 2 });
  assert.equal(second, first);
  assert.equal(calls, 1);
  d.resolve({ ok: true, status: 201, data: {} });
  await first;
  assert.equal(submitter.pending, false);
});

// ---------- endereços salvos (conta do cliente) ----------
const {
  NEW_ADDRESS, defaultAddressChoice, applyAddressChoice, addressToSave, prefillFromMe, addressLabel,
} = await import('../../../public/js/order-payload.js');

const addrs = [
  { id: 'a', label: 'Casa', street: 'Rua A', number: '1', district: 'Centro', reference: null, isDefault: false },
  { id: 'b', label: null, street: 'Rua B', number: '22', district: 'Aldeota', reference: 'Portão azul', isDefault: true },
];
const delivery = (extra = {}) => ({
  name: 'Ana', phone: '(85) 99999-9999', fulfillment: 'delivery', payment: 'pix', ...extra,
});

test('defaultAddressChoice devolve o padrão ou "new"', () => {
  assert.equal(NEW_ADDRESS, 'new');
  assert.equal(defaultAddressChoice(addrs), 'b');
  assert.equal(defaultAddressChoice([]), 'new');
  assert.equal(defaultAddressChoice(undefined), 'new');
});

test('endereço salvo vence os inputs e sai sem id/label/isDefault', () => {
  const fields = applyAddressChoice(delivery({ addressChoice: 'b', street: 'lixo' }), addrs);
  const payload = buildOrderPayload(fields, items, 0);
  assert.deepEqual(payload.address, { street: 'Rua B', number: '22', district: 'Aldeota', reference: 'Portão azul' });
  assert.deepEqual(buildOrderPayload(applyAddressChoice(delivery({ addressChoice: 'a' }), addrs), items, 0).address,
    { street: 'Rua A', number: '1', district: 'Centro', reference: '' });
});

test('escolha desconhecida vira FieldError addressChoice', () => {
  assert.throws(() => applyAddressChoice(delivery({ addressChoice: 'zzz' }), addrs),
    (e) => e instanceof FieldError && e.field === 'addressChoice');
});

test('"new" mantém os inputs; retirada ignora a escolha', () => {
  const typed = delivery({ addressChoice: 'new', street: 'Rua N', number: '9', district: 'Bairro N', reference: '' });
  assert.deepEqual(applyAddressChoice(typed, addrs), typed);
  const pickup = { name: 'Ana', phone: '(85) 99999-9999', fulfillment: 'pickup', payment: 'pix', addressChoice: 'zzz' };
  const payload = buildOrderPayload(applyAddressChoice(pickup, addrs), items, 0);
  assert.equal('address' in payload, false);
});

test('addressToSave só com "new" + saveAddress + entrega', () => {
  const f = delivery({ addressChoice: 'new', saveAddress: 'on', street: ' Rua N ', number: '9', district: 'B N', reference: '' });
  assert.deepEqual(addressToSave(f), { street: 'Rua N', number: '9', district: 'B N', reference: '' });
  assert.equal(addressToSave({ ...f, saveAddress: undefined }), null);
  assert.equal(addressToSave({ ...f, addressChoice: 'b' }), null);
  assert.equal(addressToSave({ ...f, fulfillment: 'pickup' }), null);
});

test('prefillFromMe e addressLabel', () => {
  assert.deepEqual(prefillFromMe({ profile: { name: 'Ana', phone: '85999999999' } }), { name: 'Ana', phone: '(85) 99999-9999' });
  assert.deepEqual(prefillFromMe({ profile: null }), { name: '', phone: '' });
  assert.equal(addressLabel({ label: 'Casa', street: 'Rua X', number: '123', district: 'Bairro Y' }), 'Casa — Rua X, 123');
  assert.equal(addressLabel({ label: null, street: 'Rua X', number: '123', district: 'Bairro Y' }), 'Rua X, 123 — Bairro Y');
});
