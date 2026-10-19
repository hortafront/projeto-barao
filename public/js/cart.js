// Carrinho persistente. Guarda SÓ ids, quantidades, opções e observações — nunca preço nem nome.
// Preço e nome vêm sempre do /api/menu (via productsById) e são recalculados com /shared/pricing.js.
import { calcPizzaUnitCents, calcItemCents, calcOrderSubtotalCents } from '/shared/pricing.js';

export const STORAGE_KEY = 'barao:cart:v1';
export const MAX_LINES = 30;
export const MAX_QTY = 20;
const MAX_NOTES = 140;

/**
 * Linha persistida:
 *   { key, kind: 'pizza', flavorIds, addonIds, quantity, notes }
 *   { key, kind: 'drink', productId, quantity }
 */
const sortedJoin = (ids) => [...ids].sort().join('+');

export function lineKey(item) {
  return item.kind === 'drink'
    ? `d:${item.productId}`
    : `p:${sortedJoin(item.flavorIds)}|a:${sortedJoin(item.addonIds ?? [])}`;
}

export const lineId = (line) => `${line.key}|n:${line.notes ?? ''}`;

const isIdList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x);
const validQty = (q) => Number.isInteger(q) && q >= 1 && q <= MAX_QTY;

function normalize(item) {
  if (item?.kind === 'drink') {
    const line = { kind: 'drink', productId: item.productId, quantity: item.quantity };
    return { key: lineKey(line), ...line };
  }
  const line = {
    kind: 'pizza',
    flavorIds: item?.flavorIds,
    addonIds: item?.addonIds ?? [],
    quantity: item?.quantity,
    notes: typeof item?.notes === 'string' ? item.notes.slice(0, MAX_NOTES) : '',
  };
  return isIdList(line.flavorIds) && isIdList(line.addonIds) ? { key: lineKey(line), ...line } : { ...line, key: '' };
}

function loadItems(storage) {
  try {
    const data = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
    if (data?.v !== 1 || !Array.isArray(data.items)) return [];
    return data.items.filter((i) => i && typeof i === 'object').map(normalize);
  } catch {
    return []; // storage bloqueado / JSON corrompido: começa vazio
  }
}

export function createCart({ storage = globalThis.localStorage } = {}) {
  let items = loadItems(storage);
  const listeners = new Set();

  const persist = () => {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify({ v: 1, items }));
    } catch { /* storage cheio/bloqueado: carrinho segue só em memória */ }
    for (const fn of listeners) fn(items);
  };

  const product = (productsById, id) => productsById.get(id);
  const toPricingItem = (line, productsById) => (line.kind === 'drink'
    ? { kind: 'drink', product: product(productsById, line.productId), quantity: line.quantity }
    : {
      kind: 'pizza',
      flavors: line.flavorIds.map((id) => product(productsById, id)),
      addons: line.addonIds.map((id) => product(productsById, id)),
      quantity: line.quantity,
    });

  const priceable = (line, productsById) => {
    const ok = (id, kind) => product(productsById, id)?.kind === kind;
    if (!validQty(line.quantity)) return false;
    if (line.kind === 'drink') return ok(line.productId, 'drink');
    return line.kind === 'pizza' && isIdList(line.flavorIds) && isIdList(line.addonIds)
      && line.flavorIds.length >= 1 && line.flavorIds.length <= 2
      && line.flavorIds.every((id) => ok(id, 'pizza')) && line.addonIds.every((id) => ok(id, 'addon'));
  };

  // Estrutura válida + todos os ids existem com o kind certo + no máximo 1 addon por addonGroup.
  const isValid = (line, productsById) => {
    const exists = (id, kind) => product(productsById, id)?.kind === kind;
    if (!validQty(line.quantity)) return false;
    if (line.kind === 'drink') return typeof line.productId === 'string' && exists(line.productId, 'drink');
    if (line.kind !== 'pizza' || !isIdList(line.flavorIds) || !isIdList(line.addonIds)) return false;
    if (line.flavorIds.length < 1 || line.flavorIds.length > 2) return false;
    if (new Set(line.flavorIds).size !== line.flavorIds.length) return false;
    if (new Set(line.addonIds).size !== line.addonIds.length) return false;
    if (!line.flavorIds.every((id) => exists(id, 'pizza'))) return false;
    if (!line.addonIds.every((id) => exists(id, 'addon'))) return false;
    const groups = line.addonIds.map((id) => product(productsById, id).addonGroup).filter((g) => g != null);
    return new Set(groups).size === groups.length;
  };

  const isUnavailable = (line, productsById) => {
    const ids = line.kind === 'drink' ? [line.productId] : [...line.flavorIds, ...line.addonIds];
    return ids.some((id) => product(productsById, id)?.available === false);
  };

  return {
    getItems: () => items,
    count: () => items.reduce((n, l) => n + l.quantity, 0),

    add(item) {
      const next = normalize(item);
      if (!next.key || !validQty(next.quantity) || (next.kind === 'drink' && typeof next.productId !== 'string')) return { ok: false, reason: 'INVALID_ITEM' };
      const id = lineId(next);
      const existing = items.find((l) => lineId(l) === id);
      if (existing) {
        items = items.map((l) => (l === existing ? { ...l, quantity: Math.min(MAX_QTY, l.quantity + next.quantity) } : l));
      } else {
        if (items.length >= MAX_LINES) return { ok: false, reason: 'CART_FULL' };
        items = [...items, next];
      }
      persist();
      return { ok: true };
    },

    setQuantity(id, quantity) {
      if (!Number.isInteger(quantity)) return;
      items = quantity < 1
        ? items.filter((l) => lineId(l) !== id)
        : items.map((l) => (lineId(l) === id ? { ...l, quantity: Math.min(MAX_QTY, quantity) } : l));
      persist();
    },
    remove(id) { items = items.filter((l) => lineId(l) !== id); persist(); },
    clear() { items = []; persist(); },

    /**
     * Revalida contra o cardápio atual. Remove id inexistente, kind errado, estrutura inválida
     * ou duas bordas; MANTÉM `available: false` e devolve os lineIds em `unavailable`.
     */
    reconcile(productsById) {
      const valid = items.filter((l) => isValid(l, productsById));
      const removed = items.length - valid.length;
      if (removed > 0) { items = valid; persist(); }
      return { removed, unavailable: items.filter((l) => isUnavailable(l, productsById)).map(lineId) };
    },

    isBlocked: (productsById) => items.some((l) => isUnavailable(l, productsById)),

    // Linha com produto ausente/kind errado (carrinho não reconciliado) vale 0; nunca lança.
    lineTotalCents: (line, productsById) => (priceable(line, productsById)
      ? calcItemCents(toPricingItem(line, productsById)) : 0),
    unitCents(line, productsById) {
      if (!priceable(line, productsById)) return 0;
      const p = toPricingItem(line, productsById);
      return p.kind === 'drink' ? p.product.priceCents : calcPizzaUnitCents(p.flavors, p.addons);
    },
    subtotalCents: (productsById) => calcOrderSubtotalCents(
      items.filter((l) => priceable(l, productsById)).map((l) => toPricingItem(l, productsById)),
    ),

    describe(line, productsById) {
      const name = (id) => productsById.get(id)?.name ?? 'Item indisponível';
      if (line.kind === 'drink') return name(line.productId);
      return line.flavorIds.length === 2
        ? `Pizza meio a meio: ${line.flavorIds.map(name).join(' / ')}`
        : `Pizza ${name(line.flavorIds[0])}`;
    },

    /** Itens no formato do body de POST /api/orders (sem key, sem preço). */
    toOrderItems: () => items.map(({ key, ...item }) => ({ ...item })),

    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
}
