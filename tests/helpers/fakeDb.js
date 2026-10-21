// Referência de tests/helpers/fakeDb.js — repositório EM MEMÓRIA para createApp({ db, options }).
// DEVE espelhar exatamente a interface do `db` (createRepository em src/db/repositories/index.js)
// definida na skill barao-supabase ("Interface do repositório"). Mudou lá → mude aqui no mesmo commit.
// Todos os métodos são async (como os reais) e devolvem CÓPIAS (teste não altera o estado por acidente).
import { AppError } from '../../src/errors/AppError.js';

const clone = (v) => structuredClone(v);
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// ---------------------------------------------------------------- seed = cardápio real (contrato)
export const CATEGORY_IDS = { classicas: uuid(1), especiais: uuid(2), bebidas: uuid(3), adicionais: uuid(4) };

export const IDS = {
  mista: uuid(101), calabresa: uuid(102), mussarela: uuid(103), marguerita: uuid(104),
  frango: uuid(201), portuguesa: uuid(202), bacon: uuid(203), carneDoSol: uuid(204),
  coca600: uuid(301), coca600Zero: uuid(302), coca1l: uuid(303), coca1lZero: uuid(304), guarana1l: uuid(305),
  bordaCatupiry: uuid(401), catupiryCima: uuid(402), bordaChocolate: uuid(403),
};

const BASE = 'Molho de tomate especial, mussarela, ';
// Product = { id, categoryId, kind, name, description, priceCents, imageUrl, available, sortOrder, addonGroup }
// addonGroup: 'borda' nas duas bordas (no máximo uma por pizza); null no resto (Catupiry por cima combina com tudo).
const P = (id, slug, kind, name, priceCents, description, sortOrder, addonGroup = null, imageUrl = null) =>
  ({ id, categoryId: CATEGORY_IDS[slug], kind, name, description, priceCents, imageUrl, available: true, sortOrder, addonGroup });

export function seedCategories() {
  return [
    { id: CATEGORY_IDS.classicas, slug: 'classicas', name: 'Pizzas Clássicas', sortOrder: 1 },
    { id: CATEGORY_IDS.especiais, slug: 'especiais', name: 'Pizzas Especiais', sortOrder: 2 },
    { id: CATEGORY_IDS.bebidas, slug: 'bebidas', name: 'Bebidas', sortOrder: 3 },
    { id: CATEGORY_IDS.adicionais, slug: 'adicionais', name: 'Adicionais Especiais', sortOrder: 4 },
  ];
}

export function seedProducts() {
  return [
    P(IDS.mista, 'classicas', 'pizza', 'Mista', 3049, `${BASE}presunto, calabresa, cebola, azeitona e orégano`, 1, null, '/img/products/mista.webp'),
    P(IDS.calabresa, 'classicas', 'pizza', 'Calabresa', 3049, `${BASE}calabresa, cebola, azeitona e orégano`, 2, null, '/img/products/calabresa.webp'),
    P(IDS.mussarela, 'classicas', 'pizza', 'Mussarela', 3049, `${BASE}tomate, azeitona e orégano`, 3, null, '/img/products/mussarela.webp'),
    P(IDS.marguerita, 'classicas', 'pizza', 'Marguerita', 3490, `${BASE}manjericão, tomate, parmesão e orégano`, 4, null, '/img/products/marguerita.webp'),
    P(IDS.frango, 'especiais', 'pizza', 'Frango', 3499, `${BASE}frango, milho, azeitona e orégano`, 1, null, '/img/products/frango.webp'),
    P(IDS.portuguesa, 'especiais', 'pizza', 'Portuguesa', 3499, `${BASE}presunto, ovos, cebola, pimentão, milho, azeitona e orégano`, 2, null, '/img/products/portuguesa.webp'),
    P(IDS.bacon, 'especiais', 'pizza', 'Bacon', 3999, `${BASE}bacon, azeitona e orégano`, 3, null, '/img/products/bacon.webp'),
    P(IDS.carneDoSol, 'especiais', 'pizza', 'Carne do Sol', 4299, `${BASE}carne do sol, cebola roxa, azeitona e orégano`, 4, null, null),
    P(IDS.coca600, 'bebidas', 'drink', 'Coca-Cola 600ml', 600, '', 1, null, '/img/products/coca-cola-600.webp'),
    P(IDS.coca600Zero, 'bebidas', 'drink', 'Coca-Cola 600ml Zero Açúcar', 600, '', 2, null, '/img/products/coca-cola-600-zero.webp'),
    P(IDS.coca1l, 'bebidas', 'drink', 'Coca-Cola 1 Litro', 1000, '', 3, null, '/img/products/coca-cola-1l.webp'),
    P(IDS.coca1lZero, 'bebidas', 'drink', 'Coca-Cola 1 Litro Zero Açúcar', 1000, '', 4, null, '/img/products/coca-cola-1l-zero.webp'),
    P(IDS.guarana1l, 'bebidas', 'drink', 'Guaraná 1 Litro', 800, '', 5, null, null),
    P(IDS.bordaCatupiry, 'adicionais', 'addon', 'Borda Recheada com Catupiry', 450, '', 1, 'borda'),
    P(IDS.catupiryCima, 'adicionais', 'addon', 'Finalize com Catupiry por cima', 450, 'Mais cremosidade e sabor em cada fatia', 2, null),
    P(IDS.bordaChocolate, 'adicionais', 'addon', 'Borda de Chocolate (Garoto ao Leite)', 999, '', 3, 'borda'),
  ];
}

/**
 * Horário do seed (confirmado pelo dono). weekday 0 = domingo. Abre seg, qui, sex, sáb, dom das 18:00 às 23:30;
 * FECHA terça (2) e quarta (3).
 */
export const CLOSED_WEEKDAYS = Object.freeze([2, 3]);
export function seedHours() {
  return Array.from({ length: 7 }, (_, weekday) =>
    ({ weekday, opensAt: '18:00', closesAt: '23:30', isClosed: CLOSED_WEEKDAYS.includes(weekday) }));
}

// ---------------------------------------------------------------- fábrica
/**
 * @param {object} [overrides]
 * @param {Array}  [overrides.products]   substitui o seed de produtos
 * @param {Array}  [overrides.hours]      substitui os 7 dias
 * @param {object} [overrides.settings]   ex.: { storeOverride: 'closed' }
 * @param {Object<string,{id,email}>} [overrides.users] token -> usuário (getUserByAccessToken)
 * @param {Object<string,{name,phone}>} [overrides.customers] userId -> perfil de cliente (seed de state.customers)
 * @param {() => Date} [overrides.now] relógio para createdAt/updatedAt (o MESMO passado ao createApp)
 */
export function createFakeDb(overrides = {}) {
  const now = overrides.now ?? (() => new Date());
  const state = {
    categories: seedCategories(),
    products: (overrides.products ?? seedProducts())
      .map((p) => ({ createdAt: now().toISOString(), updatedAt: now().toISOString(), ...p })),
    hours: overrides.hours ?? seedHours(),
    settings: { storeOverride: 'auto', whatsappNumber: '5585992732247', updatedAt: now().toISOString(), ...overrides.settings },
    orders: [],      // Order[] — inspecione em testes: db.state.orders
    orderSeq: 0,     // espelha a sequence order_code_seq
    productSeq: 0,
    users: overrides.users ?? {},
    customers: Object.fromEntries(Object.entries(overrides.customers ?? {}).map(([id, c]) => [id, clone(c)])), // userId -> { name, phone }
    addresses: [],   // { userId, _seq, id, label, street, number, district, reference, isDefault, createdAt, updatedAt }
    addressSeq: 0,
  };

  const findProduct = (id) => state.products.find((p) => p.id === id);
  // 'YYYY-MM-DD' local de Fortaleza (UTC-3 fixo), igual a localDayRangeToIso do repo real
  const fortalezaDate = (iso) => new Date(Date.parse(iso) - 3 * 3600_000).toISOString().slice(0, 10);
  const inRange = (o, from, to) => (!from || fortalezaDate(o.createdAt) >= from) && (!to || fortalezaDate(o.createdAt) <= to);
  // espelha o check do banco: addon_group is null or kind = 'addon'
  const assertAddonGroupFitsKind = (p) => {
    if (p.addonGroup != null && p.kind !== 'addon') throw new Error('fakeDb: addon_group só em kind = addon');
  };
  const patchProduct = (id, patch) => {
    const p = findProduct(id);
    if (!p) return null;
    const next = { ...p };
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) next[k] = clone(v); // PUT parcial
    assertAddonGroupFitsKind(next);
    next.updatedAt = now().toISOString();
    Object.assign(p, next);
    return clone(p);
  };

  // ---- clientes (helpers). _seq desempata createdAt iguais (relógio fixo): maior = inserido depois.
  const toAddress = ({ userId, _seq, ...a }) => clone(a);
  const mineAddresses = (userId) => state.addresses.filter((a) => a.userId === userId);
  const makeDefault = (userId, id) => {
    for (const a of mineAddresses(userId)) a.isDefault = a.id === id;
  };
  const sortedAddresses = (userId) => mineAddresses(userId)
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b._seq - a._seq);
  const addressFields = (d) => ({
    label: d.label || null, street: d.street, number: d.number, district: d.district, reference: d.reference || null,
  });

  return {
    state,

    // ---- cardápio
    async getMenu() {
      return clone(state.categories
        .slice().sort((a, b) => a.sortOrder - b.sortOrder)
        .map((c) => ({
          ...c,
          products: state.products.filter((p) => p.categoryId === c.id).sort((a, b) => a.sortOrder - b.sortOrder),
        })));
    },
    async getProductsByIds(ids) {
      return clone(state.products.filter((p) => ids.includes(p.id))); // inexistentes não aparecem
    },

    // ---- horários / loja
    async getHours() { return clone(state.hours); },
    async updateHours(days) { state.hours = clone(days); return clone(state.hours); },
    async getSettings() { return clone(state.settings); },
    /** Só altera o que vier: { storeOverride?, whatsappNumber? } (como o repo real). */
    async updateSettings({ storeOverride, whatsappNumber } = {}) {
      // espelha o check SQL de settings.whatsapp_number
      if (whatsappNumber !== undefined && !/^55\d{10,11}$/.test(whatsappNumber)) throw new Error('check settings.whatsapp_number');
      if (storeOverride !== undefined) state.settings.storeOverride = storeOverride;
      if (whatsappNumber !== undefined) state.settings.whatsappNumber = whatsappNumber;
      state.settings.updatedAt = now().toISOString();
      return clone(state.settings);
    },

    // ---- pedidos
    /** draft = { customer, fulfillment, address, payment, notes, subtotalCents, items: pricedItems } */
    async createOrder(draft) {
      // mesmos checks que o banco faz (constraints + create_order): bug no service vira erro no teste
      for (const i of draft.items) {
        if (i.lineTotalCents !== i.unitPriceCents * i.quantity) throw new Error('fakeDb: line_total_cents inconsistente');
        const addonsCents = (i.addons ?? []).reduce((s, a) => s + a.priceCents, 0);
        if (i.unitPriceCents !== i.baseUnitCents + addonsCents) throw new Error('fakeDb: unit_price_cents ≠ base + addons');
        if (!i.productIds?.length) throw new Error('fakeDb: product_ids vazio');
      }
      const sum = draft.items.reduce((s, i) => s + i.lineTotalCents, 0);
      if (sum !== draft.subtotalCents) throw new Error('fakeDb: subtotal_cents ≠ soma das linhas');
      if (draft.fulfillment === 'delivery' && !draft.address) throw new Error('fakeDb: entrega sem endereço');
      if (draft.customerId && !state.customers[draft.customerId]) throw new Error('fakeDb: customer_id sem perfil (FK)');

      state.orderSeq += 1;
      const order = {
        id: uuid(900000 + state.orderSeq),
        code: `BR-${String(state.orderSeq).padStart(4, '0')}`,
        status: 'received',
        createdAt: now().toISOString(),
        customerId: draft.customerId ?? null,
        customer: clone(draft.customer),
        fulfillment: draft.fulfillment,
        address: draft.fulfillment === 'delivery'
          ? { ...clone(draft.address), reference: draft.address.reference || null }
          : null,
        payment: { method: draft.payment.method, changeForCents: draft.payment.changeForCents ?? null },
        notes: draft.notes ?? null,
        subtotalCents: draft.subtotalCents,
        items: draft.items.map((i, n) => ({ // snapshot, como order_items
          id: uuid(800000 + state.orderSeq * 100 + n),
          kind: i.kind,
          description: i.description,
          productIds: [...i.productIds],
          flavorNames: i.flavorNames ?? null,
          addons: (i.addons ?? []).map((a) => ({ name: a.name, priceCents: a.priceCents })), // jsonb
          baseUnitCents: i.baseUnitCents,
          unitPriceCents: i.unitPriceCents,
          quantity: i.quantity,
          notes: i.notes ?? null,
          lineTotalCents: i.lineTotalCents,
        })),
      };
      state.orders.push(order);
      return { id: order.id, code: order.code, createdAt: order.createdAt };
    },
    async listOrders({ from, to, page = 1, pageSize = 20 }) {
      const all = state.orders.filter((o) => inRange(o, from, to)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return clone({ orders: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize });
    },
    async getOrderById(id) { return clone(state.orders.find((o) => o.id === id) ?? null); },
    async updateOrderStatus(id, status) {
      const o = state.orders.find((x) => x.id === id);
      if (!o) return null;
      o.status = status;
      return clone(o);
    },
    /** Igual à rpc orders_summary: exclui cancelados; top 10 por descrição. */
    async getOrdersSummary({ from, to }) {
      const valid = state.orders.filter((o) => o.status !== 'canceled' && inRange(o, from, to));
      const qty = new Map();
      for (const o of valid) {
        for (const it of o.items) qty.set(it.description, (qty.get(it.description) ?? 0) + it.quantity);
      }
      return {
        ordersCount: valid.length,
        grossCents: valid.reduce((s, o) => s + o.subtotalCents, 0),
        topItems: [...qty].map(([name, quantity]) => ({ name, quantity }))
          .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name))
          .slice(0, 10),
      };
    },

    // ---- admin: categorias / produtos
    async listCategories() { return clone(state.categories); },
    async listProducts() { return clone(state.products); },
    async getProductById(id) { return clone(findProduct(id) ?? null); },
    async createProduct(input) {
      state.productSeq += 1;
      const stamp = now().toISOString();
      const p = { imageUrl: null, addonGroup: null, ...clone(input), id: uuid(500 + state.productSeq), createdAt: stamp, updatedAt: stamp };
      assertAddonGroupFitsKind(p);
      state.products.push(p);
      return clone(p);
    },
    async updateProduct(id, patch) { return patchProduct(id, patch); },
    /** true = removido; false = não existe; lança PRODUCT_HAS_ORDERS se algum item salvo tem o id em productIds. */
    async deleteProduct(id) {
      if (state.orders.some((o) => o.items.some((it) => it.productIds.includes(id)))) {
        throw new AppError('PRODUCT_HAS_ORDERS', 409, 'Produto já tem pedidos; marque como esgotado em vez de excluir');
      }
      const before = state.products.length;
      state.products = state.products.filter((p) => p.id !== id);
      return state.products.length < before;
    },
    async setProductAvailability(id, available) { return patchProduct(id, { available }); },
    async uploadProductImage(id, { contentType }) {
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[contentType];
      const url = `https://fake.supabase.co/storage/v1/object/public/product-images/products/${id}-${now().getTime()}.${ext}`;
      return patchProduct(id, { imageUrl: url });
    },

    // ---- auth (real: supabase.auth.getUser(token)); null = token inválido/expirado
    async getUserByAccessToken(token) { return clone(state.users[token] ?? null); },

    // ---- clientes
    async getCustomer(userId) { return clone(state.customers[userId] ?? null); },
    async upsertCustomer(userId, { name, phone }) {
      state.customers[userId] = { name, phone };
      return clone(state.customers[userId]);
    },
    async listAddresses(userId) { return sortedAddresses(userId).map(toAddress); },
    /** isDefault true desmarca os outros; false/ausente não vira padrão (a regra do 1º endereço é do service). */
    async createAddress(userId, data) {
      if (!state.customers[userId]) throw new Error('fakeDb: customer_addresses.user_id sem perfil (FK)');
      state.addressSeq += 1;
      const stamp = now().toISOString();
      const a = { userId, _seq: state.addressSeq, id: uuid(700000 + state.addressSeq), ...addressFields(data),
        isDefault: false, createdAt: stamp, updatedAt: stamp };
      state.addresses.push(a);
      if (data.isDefault === true) makeDefault(userId, a.id);
      return toAddress(a);
    },
    async updateAddress(userId, id, data) {
      const a = mineAddresses(userId).find((x) => x.id === id);
      if (!a) return null;
      Object.assign(a, addressFields(data), { updatedAt: now().toISOString() });
      if (data.isDefault === true) makeDefault(userId, id);
      return toAddress(a);
    },
    /** true = removido. Se era o padrão, o mais recente restante vira padrão. */
    async deleteAddress(userId, id) {
      const a = mineAddresses(userId).find((x) => x.id === id);
      if (!a) return false;
      state.addresses = state.addresses.filter((x) => x !== a);
      if (a.isDefault) {
        const next = mineAddresses(userId).sort((x, y) => y._seq - x._seq)[0];
        if (next) next.isDefault = true;
      }
      return true;
    },
    async setDefaultAddress(userId, id) {
      const a = mineAddresses(userId).find((x) => x.id === id);
      if (!a) return null;
      makeDefault(userId, id);
      return toAddress(a);
    },
    /** Apaga perfil, endereços e usuários (Auth) com esse id; pedidos ficam com customerId null (on delete set null). */
    async deleteCustomerAccount(userId) {
      delete state.customers[userId];
      state.addresses = state.addresses.filter((a) => a.userId !== userId);
      for (const [token, u] of Object.entries(state.users)) if (u.id === userId) delete state.users[token];
      for (const o of state.orders) if (o.customerId === userId) o.customerId = null;
    },
  };
}
