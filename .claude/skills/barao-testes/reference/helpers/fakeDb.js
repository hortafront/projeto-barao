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
const P = (id, slug, kind, name, priceCents, description, sortOrder, addonGroup = null) =>
  ({ id, categoryId: CATEGORY_IDS[slug], kind, name, description, priceCents, imageUrl: null, available: true, sortOrder, addonGroup });

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
    P(IDS.mista, 'classicas', 'pizza', 'Mista', 3049, `${BASE}presunto, calabresa, cebola, azeitona e orégano`, 1),
    P(IDS.calabresa, 'classicas', 'pizza', 'Calabresa', 3049, `${BASE}calabresa, cebola, azeitona e orégano`, 2),
    P(IDS.mussarela, 'classicas', 'pizza', 'Mussarela', 3049, `${BASE}tomate, azeitona e orégano`, 3),
    P(IDS.marguerita, 'classicas', 'pizza', 'Marguerita', 3490, `${BASE}manjericão, tomate, parmesão e orégano`, 4),
    P(IDS.frango, 'especiais', 'pizza', 'Frango', 3499, `${BASE}frango, milho, azeitona e orégano`, 1),
    P(IDS.portuguesa, 'especiais', 'pizza', 'Portuguesa', 3499, `${BASE}presunto, ovos, cebola, pimentão, milho, azeitona e orégano`, 2),
    P(IDS.bacon, 'especiais', 'pizza', 'Bacon', 3999, `${BASE}bacon, azeitona e orégano`, 3),
    P(IDS.carneDoSol, 'especiais', 'pizza', 'Carne do Sol', 4299, `${BASE}carne do sol, cebola roxa, azeitona e orégano`, 4),
    P(IDS.coca600, 'bebidas', 'drink', 'Coca-Cola 600ml', 600, '', 1),
    P(IDS.coca600Zero, 'bebidas', 'drink', 'Coca-Cola 600ml Zero Açúcar', 600, '', 2),
    P(IDS.coca1l, 'bebidas', 'drink', 'Coca-Cola 1 Litro', 1000, '', 3),
    P(IDS.coca1lZero, 'bebidas', 'drink', 'Coca-Cola 1 Litro Zero Açúcar', 1000, '', 4),
    P(IDS.guarana1l, 'bebidas', 'drink', 'Guaraná 1 Litro', 800, '', 5),
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
 * @param {() => Date} [overrides.now] relógio para createdAt/updatedAt (o MESMO passado ao createApp)
 */
export function createFakeDb(overrides = {}) {
  const now = overrides.now ?? (() => new Date());
  const state = {
    categories: seedCategories(),
    products: overrides.products ?? seedProducts(),
    hours: overrides.hours ?? seedHours(),
    settings: { storeOverride: 'auto', whatsappNumber: '5585997687641', updatedAt: now().toISOString(), ...overrides.settings },
    orders: [],      // Order[] — inspecione em testes: db.state.orders
    orderSeq: 0,     // espelha a sequence order_code_seq
    productSeq: 0,
    users: overrides.users ?? {},
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
    Object.assign(p, next);
    return clone(p);
  };

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
    async updateSettings({ storeOverride }) {
      Object.assign(state.settings, { storeOverride, updatedAt: now().toISOString() });
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

      state.orderSeq += 1;
      const order = {
        id: uuid(900000 + state.orderSeq),
        code: `BR-${String(state.orderSeq).padStart(4, '0')}`,
        status: 'received',
        createdAt: now().toISOString(),
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
      const p = { imageUrl: null, addonGroup: null, ...clone(input), id: uuid(500 + state.productSeq) };
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
  };
}
