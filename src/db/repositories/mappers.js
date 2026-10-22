import { AppError } from '../../errors/AppError.js';

export const PRODUCT_COLUMNS =
  'id, category_id, kind, name, description, price_cents, image_url, available, sort_order, addon_group';
export const ADMIN_PRODUCT_COLUMNS = `${PRODUCT_COLUMNS}, created_at, updated_at`;

export function toProduct(r) {
  return {
    id: r.id, categoryId: r.category_id, kind: r.kind, name: r.name, description: r.description,
    priceCents: r.price_cents, imageUrl: r.image_url, available: r.available, sortOrder: r.sort_order,
    addonGroup: r.addon_group ?? null, // 'borda' | null — addons do mesmo grupo são exclusivos na pizza
    createdAt: r.created_at, updatedAt: r.updated_at, // só presentes nas colunas de admin
  };
}

export const BUCKET = 'product-images';
export const IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Caminho no bucket a partir da URL pública (parte após '/product-images/'); null se não for do bucket. */
export function storagePathFromUrl(url) {
  if (!url) return null;
  const marker = `/${BUCKET}/`;
  const i = url.indexOf(marker);
  if (i === -1) return null;
  const path = decodeURIComponent(url.slice(i + marker.length).split('?')[0]);
  return path || null;
}

export const COMBO_SELECT =
  'id, name, description, price_cents, image_url, weekdays, available, created_at, updated_at, '
  + 'combo_slots(id, position, label, kind, product_ids)';

export function toCombo(r) {
  return {
    id: r.id, name: r.name, description: r.description ?? '', priceCents: r.price_cents,
    imageUrl: r.image_url ?? null, weekdays: r.weekdays, available: r.available,
    slots: (r.combo_slots ?? []).slice().sort((a, b) => a.position - b.position).map((s) => ({
      id: s.id, position: s.position, label: s.label, kind: s.kind, productIds: s.product_ids,
    })),
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export const ADDRESS_COLUMNS =
  'id, label, street, number, district, reference, is_default, created_at, updated_at';

export function toAddress(r) {
  return {
    id: r.id, label: r.label ?? null, street: r.street, number: r.number, district: r.district,
    reference: r.reference ?? null, isDefault: r.is_default, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function toOrder(r) {
  return {
    id: r.id, code: r.code, status: r.status, createdAt: r.created_at,
    customer: { name: r.customer_name, phone: r.customer_phone },
    fulfillment: r.fulfillment,
    address: r.fulfillment === 'delivery'
      ? { street: r.address_street, number: r.address_number, district: r.address_district, reference: r.address_reference }
      : null,
    payment: { method: r.payment_method, changeForCents: r.change_for_cents },
    notes: r.notes, subtotalCents: r.subtotal_cents,
    items: (r.order_items ?? []).map((i) => ({
      id: i.id, kind: i.kind, description: i.description, productIds: i.product_ids,
      flavorNames: i.flavor_names, addons: i.addons ?? [], // [{ name, priceCents }]
      baseUnitCents: i.base_unit_cents, unitPriceCents: i.unit_price_cents, quantity: i.quantity,
      notes: i.notes, lineTotalCents: i.line_total_cents,
      comboId: i.combo_id ?? null, choices: i.combo_choices ?? null, // só em kind = 'combo'
    })),
  };
}

/** Converte erro do supabase-js em AppError INTERNAL (detalhe só no log, nunca na resposta). */
export function dbError(op, error) {
  return new AppError('INTERNAL', 500, 'Erro ao acessar o banco de dados.', undefined, {
    cause: Object.assign(new Error(`${op}: ${error.message}`), { pgCode: error.code }),
  });
}

/** 'YYYY-MM-DD' (dia local de Fortaleza, UTC-3 fixo) -> intervalo ISO [from, to+1) */
export function localDayRangeToIso(from, to) {
  const next = new Date(`${to}T00:00:00-03:00`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { fromIso: new Date(`${from}T00:00:00-03:00`).toISOString(), toIso: next.toISOString() };
}
