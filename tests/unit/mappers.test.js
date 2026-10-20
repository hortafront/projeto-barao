import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDayRangeToIso, toProduct, toOrder, dbError } from '../../src/db/repositories/mappers.js';
import { AppError } from '../../src/errors/AppError.js';

test('localDayRangeToIso converte dias de Fortaleza (UTC-3) em [from, to+1) UTC', () => {
  assert.deepEqual(localDayRangeToIso('2026-10-18', '2026-10-18'), {
    fromIso: '2026-10-18T03:00:00.000Z',
    toIso: '2026-10-19T03:00:00.000Z',
  });
});

test('toProduct converte snake_case em camelCase', () => {
  const p = toProduct({
    id: 'p1', category_id: 'c1', kind: 'pizza', name: 'Calabresa', description: 'd', price_cents: 4500,
    image_url: null, available: true, sort_order: 2, addon_group: null,
    created_at: '2026-10-18T10:00:00Z', updated_at: '2026-10-18T11:00:00Z',
  });
  assert.deepEqual(p, {
    id: 'p1', categoryId: 'c1', kind: 'pizza', name: 'Calabresa', description: 'd', priceCents: 4500,
    imageUrl: null, available: true, sortOrder: 2, addonGroup: null,
    createdAt: '2026-10-18T10:00:00Z', updatedAt: '2026-10-18T11:00:00Z',
  });
});

test('toOrder de retirada tem address null', () => {
  const o = toOrder({
    id: 'o1', code: 'BR-0001', status: 'received', created_at: 'x', customer_name: 'Ana', customer_phone: '85999999999',
    fulfillment: 'pickup', address_street: null, address_number: null, address_district: null, address_reference: null,
    payment_method: 'pix', change_for_cents: null, notes: null, subtotal_cents: 100, order_items: [],
  });
  assert.equal(o.address, null);
  assert.deepEqual(o.items, []);
});

test('dbError gera AppError INTERNAL 500 com pgCode na cause', () => {
  const e = dbError('op', { message: 'x', code: '23514' });
  assert.ok(e instanceof AppError);
  assert.equal(e.code, 'INTERNAL');
  assert.equal(e.status, 500);
  assert.equal(e.cause.pgCode, '23514');
});
