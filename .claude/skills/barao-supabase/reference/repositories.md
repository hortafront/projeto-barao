# Referência — `src/db/supabase.js` e `src/db/repositories/*.repo.js`

Convenções: repositories recebem o client por parâmetro (factory), devolvem **objetos de domínio em camelCase** e **lançam** erro (nunca devolvem `{ data, error }` para cima). `AppError` vem de `src/errors/AppError.js` (skill `barao-api-express`).

## `src/db/supabase.js`
```js
import { createClient } from '@supabase/supabase-js';

export function createSupabaseClient({
  url = process.env.SUPABASE_URL,
  serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
} = {}) {
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios');
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
```

## `src/db/repositories/mappers.js`
```js
import { AppError } from '../../errors/AppError.js';

export const PRODUCT_COLUMNS =
  'id, category_id, kind, name, description, price_cents, image_url, available, sort_order';

export function toProduct(r) {
  return {
    id: r.id, categoryId: r.category_id, kind: r.kind, name: r.name, description: r.description,
    priceCents: r.price_cents, imageUrl: r.image_url, available: r.available, sortOrder: r.sort_order,
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
```

## `src/db/repositories/menu.repo.js`
```js
import { PRODUCT_COLUMNS, toProduct, dbError } from './mappers.js';

export function createMenuRepo(supabase) {
  return {
    async getMenu() {
      const { data, error } = await supabase
        .from('categories')
        .select(`id, slug, name, sort_order, products(${PRODUCT_COLUMNS})`)
        .order('sort_order', { ascending: true })
        .order('sort_order', { referencedTable: 'products', ascending: true });
      if (error) throw dbError('getMenu', error);
      return data.map((c) => ({
        id: c.id, slug: c.slug, name: c.name, sortOrder: c.sort_order,
        products: (c.products ?? []).map(toProduct),
      }));
    },

    async getProductsByIds(ids) {
      if (ids.length === 0) return [];
      const { data, error } = await supabase.from('products').select(PRODUCT_COLUMNS).in('id', ids);
      if (error) throw dbError('getProductsByIds', error);
      return data.map(toProduct); // ids inexistentes simplesmente não voltam
    },
  };
}
```

## `src/db/repositories/orders.repo.js`
```js
import { toOrder, dbError, localDayRangeToIso } from './mappers.js';

export function createOrdersRepo(supabase) {
  return {
    /** draft: ver barao-pedido-whatsapp (order.service). Retorna { id, code, createdAt }. */
    async createOrder(draft) {
      const a = draft.address;
      const payload = {
        customer_name: draft.customer.name,
        customer_phone: draft.customer.phone,
        fulfillment: draft.fulfillment,
        address_street: a?.street ?? null,
        address_number: a?.number ?? null,
        address_district: a?.district ?? null,
        address_reference: a?.reference || null,
        payment_method: draft.payment.method,
        change_for_cents: draft.payment.changeForCents ?? null,
        notes: draft.notes ?? null,
        subtotal_cents: draft.subtotalCents,
        items: draft.items.map((i) => ({
          kind: i.kind, description: i.description, product_ids: i.productIds,
          flavor_names: i.flavorNames,
          addons: (i.addons ?? []).map((a) => ({ name: a.name, priceCents: a.priceCents })), // jsonb snapshot
          base_unit_cents: i.baseUnitCents, unit_price_cents: i.unitPriceCents, quantity: i.quantity,
          notes: i.notes ?? null, line_total_cents: i.lineTotalCents,
        })),
      };
      const { data, error } = await supabase.rpc('create_order', { payload });
      if (error) throw dbError('createOrder', error);
      return { id: data.id, code: data.code, createdAt: data.created_at };
    },

    async listOrders({ from, to, page = 1, pageSize = 20 }) {
      const { fromIso, toIso } = localDayRangeToIso(from, to);
      const offset = (page - 1) * pageSize;
      const { data, error, count } = await supabase
        .from('orders')
        .select('*, order_items(*)', { count: 'exact' })
        .gte('created_at', fromIso).lt('created_at', toIso)
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (error) throw dbError('listOrders', error);
      return { orders: data.map(toOrder), total: count ?? 0, page, pageSize };
    },

    async getOrderById(id) {
      const { data, error } = await supabase
        .from('orders').select('*, order_items(*)').eq('id', id).maybeSingle();
      if (error) throw dbError('getOrderById', error);
      return data ? toOrder(data) : null;
    },

    async updateOrderStatus(id, status) {
      const { data, error } = await supabase
        .from('orders').update({ status }).eq('id', id).select('*, order_items(*)').maybeSingle();
      if (error) throw dbError('updateOrderStatus', error);
      return data ? toOrder(data) : null;
    },

    async getOrdersSummary({ from, to }) {
      const { fromIso, toIso } = localDayRangeToIso(from, to);
      const { data, error } = await supabase.rpc('orders_summary', { p_from: fromIso, p_to: toIso });
      if (error) throw dbError('getOrdersSummary', error);
      return { ordersCount: data.orders_count, grossCents: data.gross_cents, topItems: data.top_items };
    },
  };
}
```

## `src/db/repositories/store.repo.js` (horários + settings)
```js
import { dbError } from './mappers.js';

const toHours = (r) => ({ weekday: r.weekday, opensAt: r.opens_at.slice(0, 5), closesAt: r.closes_at.slice(0, 5), isClosed: r.is_closed });
const toSettings = (r) => ({ storeOverride: r.store_override, whatsappNumber: r.whatsapp_number, updatedAt: r.updated_at });

export function createStoreRepo(supabase) {
  return {
    async getHours() {
      const { data, error } = await supabase.from('business_hours').select('*').order('weekday');
      if (error) throw dbError('getHours', error);
      return data.map(toHours);
    },
    async updateHours(days) { // array dos 7 dias já validado (hours.schema.js)
      const rows = days.map((d) => ({ weekday: d.weekday, opens_at: d.opensAt, closes_at: d.closesAt, is_closed: d.isClosed }));
      const { data, error } = await supabase.from('business_hours').upsert(rows, { onConflict: 'weekday' }).select('*').order('weekday');
      if (error) throw dbError('updateHours', error);
      return data.map(toHours);
    },
    async getSettings() {
      const { data, error } = await supabase.from('settings').select('*').eq('id', 1).single();
      if (error) throw dbError('getSettings', error);
      return toSettings(data);
    },
    async updateSettings({ storeOverride }) {
      const { data, error } = await supabase.from('settings').update({ store_override: storeOverride }).eq('id', 1).select('*').single();
      if (error) throw dbError('updateSettings', error);
      return toSettings(data);
    },
  };
}
```

## `src/db/repositories/products.repo.js` (admin + Storage) — trechos
```js
import { PRODUCT_COLUMNS, toProduct, dbError } from './mappers.js';
import { AppError } from '../../errors/AppError.js';

const BUCKET = 'product-images';
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const toRow = (p) => Object.fromEntries(Object.entries({
  category_id: p.categoryId, kind: p.kind, name: p.name, description: p.description,
  price_cents: p.priceCents, available: p.available, sort_order: p.sortOrder,
}).filter(([, v]) => v !== undefined)); // PUT parcial: não sobrescreve com undefined

export function createProductsRepo(supabase) {
  async function update(id, row, op) {
    const { data, error } = await supabase.from('products').update(row).eq('id', id).select(PRODUCT_COLUMNS).maybeSingle();
    if (error) throw dbError(op, error);
    return data ? toProduct(data) : null;
  }
  return {
    // listCategories, listProducts, getProductById, createProduct: mesmo padrão

    /**
     * true = removido; false = não existe (rota → 404).
     * Lança AppError PRODUCT_HAS_ORDERS (409) se algum order_item referencia o id (product_ids @> array[id]).
     */
    async deleteProduct(id) {
      const { count, error: usedErr } = await supabase
        .from('order_items').select('id', { count: 'exact', head: true })
        .contains('product_ids', [id]); // product_ids @> array[id] (usa o índice GIN)
      if (usedErr) throw dbError('deleteProduct', usedErr);
      if (count > 0) {
        throw new AppError('PRODUCT_HAS_ORDERS', 409, 'Produto já tem pedidos; marque como esgotado em vez de excluir');
      }
      const { data, error } = await supabase.from('products').delete().eq('id', id).select('id');
      if (error) throw dbError('deleteProduct', error);
      return data.length > 0;
    },
    updateProduct: (id, patch) => update(id, toRow(patch), 'updateProduct'),
    setProductAvailability: (id, available) => update(id, { available }, 'setProductAvailability'),

    /** Upload pelo servidor (service role). Retorna o produto com imageUrl pública. */
    async uploadProductImage(id, { buffer, contentType }) {
      const path = `products/${id}-${Date.now()}.${EXT[contentType]}`;
      const { error } = await supabase.storage.from(BUCKET)
        .upload(path, buffer, { contentType, cacheControl: '31536000', upsert: false });
      if (error) throw dbError('uploadProductImage', error);
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path); // não faz request, não tem error
      return update(id, { image_url: data.publicUrl }, 'uploadProductImage');
    },
  };
}
```
Nome de arquivo novo a cada upload (`Date.now()`) = cache longo sem servir imagem velha. Apagar a imagem anterior é opcional (best effort, `storage.from(BUCKET).remove([oldPath])`).

## `src/db/repositories/auth.repo.js`
```js
import { dbError } from './mappers.js';

export function createAuthRepo(supabase) {
  return {
    /** Valida o access_token do admin. null = token inválido/expirado. */
    async getUserByAccessToken(token) {
      const { data, error } = await supabase.auth.getUser(token);
      if (error) {
        if (error.status && error.status < 500) return null;
        throw dbError('getUserByAccessToken', error);
      }
      return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
    },
  };
}
```

## `src/db/repositories/index.js`
```js
import { createMenuRepo } from './menu.repo.js';
import { createOrdersRepo } from './orders.repo.js';
import { createStoreRepo } from './store.repo.js';
import { createProductsRepo } from './products.repo.js';
import { createAuthRepo } from './auth.repo.js';

export function createRepository(supabase) {
  return {
    ...createMenuRepo(supabase),
    ...createOrdersRepo(supabase),
    ...createStoreRepo(supabase),
    ...createProductsRepo(supabase),
    ...createAuthRepo(supabase),
  };
}
```
