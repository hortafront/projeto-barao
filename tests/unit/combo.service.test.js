import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb } from '../helpers/fakeDb.js';
import { IDS, seedCombo } from '../helpers/testkit.js';
import { WEEKDAY_NAMES, todayWeekday, getTodayPublicCombo, assertComboInput } from '../../src/services/combo.service.js';

const TZ = 'America/Fortaleza';
const THU = new Date('2026-10-23T02:59:00Z');
const FRI = new Date('2026-10-23T03:00:00Z');

const publicMap = async (db) => new Map((await db.listProducts()).map((p) => [p.id, p]));
const input = (over = {}) => ({
  name: 'Novo', description: '', priceCents: 3000, weekdays: [5],
  slots: [{ label: 'Pizza', kind: 'pizza', productIds: [IDS.mista] }],
  ...over,
});
const rejects = (p, path, re) => assert.rejects(p, (e) => {
  assert.equal(e.code, 'VALIDATION_ERROR');
  assert.equal(e.status, 400);
  assert.equal(e.details[0].path, path);
  assert.match(e.details[0].message, re);
  return true;
});

test('WEEKDAY_NAMES e todayWeekday respeitam o fuso de Fortaleza', () => {
  assert.equal(WEEKDAY_NAMES[4], 'quinta-feira');
  assert.equal(WEEKDAY_NAMES[0], 'domingo');
  assert.equal(todayWeekday(THU, TZ), 4);
  assert.equal(todayWeekday(FRI, TZ), 5);
});

test('conflito de dia com outro combo', async () => {
  const db = createFakeDb();
  await seedCombo(db);
  await rejects(assertComboInput(db, input({ weekdays: [4, 5] })), 'weekdays', /^Já existe um combo na quinta-feira: Combo Clássico\.$/);
});

test('editar o próprio combo mantendo o dia passa (excludeId)', async () => {
  const db = createFakeDb();
  const c = await seedCombo(db);
  await assertComboInput(db, input({ weekdays: [4] }), { excludeId: c.id });
  await assert.rejects(assertComboInput(db, input({ weekdays: [4] })));
});

test('bebida em vaga de pizza e id inexistente são rejeitados', async () => {
  const db = createFakeDb();
  await rejects(
    assertComboInput(db, input({ slots: [{ label: 'Pizza', kind: 'pizza', productIds: [IDS.coca1l] }] })),
    'slots.0.productIds', /Coca.* não pode ser usado nesta vaga\./);
  await rejects(
    assertComboInput(db, input({ slots: [
      { label: 'Pizza', kind: 'pizza', productIds: [IDS.mista] },
      { label: 'Bebida', kind: 'drink', productIds: ['00000000-0000-4000-8000-00000000dead'] }] })),
    'slots.1.productIds', /não pode ser usado nesta vaga\./);
  await assertComboInput(db, input());
});

test('getTodayPublicCombo: sem combo hoje -> null', async () => {
  const db = createFakeDb();
  await seedCombo(db);
  assert.equal(await getTodayPublicCombo(db, { now: FRI, timeZone: TZ, productsById: await publicMap(db) }), null);
});

test('getTodayPublicCombo: produto excluído some da vaga', async () => {
  const db = createFakeDb();
  await seedCombo(db);
  const productsById = await publicMap(db);
  productsById.delete(IDS.mista);
  const c = await getTodayPublicCombo(db, { now: THU, timeZone: TZ, productsById });
  assert.equal(c.name, 'Combo Clássico');
  assert.equal(c.priceCents, 3690);
  assert.equal(c.available, true);
  assert.ok(!c.slots[0].productIds.includes(IDS.mista));
  assert.equal(c.slots[0].productIds.length, 3);
  assert.deepEqual(Object.keys(c).sort(), ['available', 'description', 'id', 'imageUrl', 'name', 'priceCents', 'slots']);
});

test('getTodayPublicCombo: vaga só com esgotados -> available false', async () => {
  const db = createFakeDb();
  await seedCombo(db);
  const productsById = await publicMap(db);
  for (const id of [IDS.coca1l, IDS.coca1lZero]) productsById.set(id, { ...productsById.get(id), available: false });
  const c = await getTodayPublicCombo(db, { now: THU, timeZone: TZ, productsById });
  assert.equal(c.available, false);
  assert.equal(c.slots[1].productIds.length, 2);
});

test('getTodayPublicCombo: combo esgotado pelo dono -> available false', async () => {
  const db = createFakeDb();
  const c0 = await seedCombo(db);
  await db.setComboAvailability(c0.id, false);
  const c = await getTodayPublicCombo(db, { now: THU, timeZone: TZ, productsById: await publicMap(db) });
  assert.equal(c.available, false);
});
