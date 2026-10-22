// Carrinho persistente. Guarda SÓ ids, quantidades, opções e observações — nunca preço nem nome.
// Preço e nome vêm sempre do /api/menu (via productsById) e são recalculados com /shared/pricing.js.
import { calcPizzaUnitCents, calcComboUnitCents, calcItemCents, calcOrderSubtotalCents } from '/shared/pricing.js';
import { describeComboSlots, describePizza } from './combo-modal.js';

export const STORAGE_KEY = 'barao:cart:v1';
export const MAX_LINES = 30;
export const MAX_QTY = 20;
const MAX_NOTES = 140;
const MAX_ADDONS = 10;
const MAX_COMBO_SLOTS = 4;

/**
 * Linha persistida:
 *   { key, kind: 'pizza', flavorIds, addonIds, quantity, notes }
 *   { key, kind: 'drink', productId, quantity }
 *   { key, kind: 'combo', comboId, slots: [{ kind:'pizza', flavorIds, addonIds } | { kind:'drink', productId }], quantity, notes }
 */
const sortedJoin = (ids) => [...ids].sort().join('+');

const slotKey = (slot) => (slot.kind === 'drink'
  ? `d:${slot.productId}`
  : `p:${sortedJoin(slot.flavorIds)}|a:${sortedJoin(slot.addonIds ?? [])}`);

export function lineKey(item) {
  if (item.kind === 'combo') return `c:${item.comboId}|${item.slots.map(slotKey).join(';')}`;
  return item.kind === 'drink'
    ? `d:${item.productId}`
    : `p:${sortedJoin(item.flavorIds)}|a:${sortedJoin(item.addonIds ?? [])}`;
}

export const lineId = (line) => `${line.key}|n:${line.notes ?? ''}`;

const isIdList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x);
const validQty = (q) => Number.isInteger(q) && q >= 1 && q <= MAX_QTY;

// Estrutura que o servidor aceita (sem checar existência no cardápio nem formato de UUID).
const distinct = (ids) => new Set(ids).size === ids.length;
const validPizzaChoice = (s) => isIdList(s.flavorIds) && isIdList(s.addonIds)
  && s.flavorIds.length >= 1 && s.flavorIds.length <= 2 && distinct(s.flavorIds)
  && s.addonIds.length <= MAX_ADDONS && distinct(s.addonIds);
const validSlot = (s) => (s?.kind === 'drink'
  ? typeof s.productId === 'string' && s.productId !== ''
  : s?.kind === 'pizza' && validPizzaChoice(s));

function hasValidShape(line) {
  if (!validQty(line?.quantity)) return false;
  if (line.kind === 'combo') {
    return typeof line.comboId === 'string' && line.comboId !== ''
      && Array.isArray(line.slots) && line.slots.length >= 1 && line.slots.length <= MAX_COMBO_SLOTS
      && line.slots.every(validSlot);
  }
  if (line.kind === 'drink') return typeof line.productId === 'string' && line.productId !== '';
  return line.kind === 'pizza' && validPizzaChoice(line);
}

const normalizeSlot = (s) => (s?.kind === 'drink'
  ? { kind: 'drink', productId: s.productId }
  : { kind: 'pizza', flavorIds: s?.flavorIds, addonIds: s?.addonIds ?? [] });

function normalize(item) {
  if (item?.kind === 'combo') {
    const line = {
      kind: 'combo',
      comboId: item.comboId,
      slots: Array.isArray(item.slots) ? item.slots.map(normalizeSlot) : [],
      quantity: item.quantity,
      notes: typeof item.notes === 'string' ? item.notes.slice(0, MAX_NOTES) : '',
    };
    return line.slots.length > 0 && line.slots.every(validSlot) ? { key: lineKey(line), ...line } : { ...line, key: '' };
  }
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
  const comboOf = (line, productsById) => {
    const c = product(productsById, line.comboId);
    return c?.kind === 'combo' ? c : null;
  };
  const comboAddonIds = (line) => line.slots.flatMap((s) => (s.kind === 'pizza' ? s.addonIds : []));
  const toPricingItem = (line, productsById) => {
    if (line.kind === 'combo') {
      return {
        kind: 'combo',
        combo: comboOf(line, productsById),
        addons: comboAddonIds(line).map((id) => product(productsById, id)),
        quantity: line.quantity,
      };
    }
    return line.kind === 'drink'
      ? { kind: 'drink', product: product(productsById, line.productId), quantity: line.quantity }
      : {
        kind: 'pizza',
        flavors: line.flavorIds.map((id) => product(productsById, id)),
        addons: line.addonIds.map((id) => product(productsById, id)),
        quantity: line.quantity,
      };
  };

  const priceable = (line, productsById) => {
    if (!hasValidShape(line)) return false;
    const ok = (id, kind) => product(productsById, id)?.kind === kind;
    if (line.kind === 'combo') return comboOf(line, productsById) != null && comboAddonIds(line).every((id) => ok(id, 'addon'));
    if (line.kind === 'drink') return ok(line.productId, 'drink');
    return line.flavorIds.every((id) => ok(id, 'pizza')) && line.addonIds.every((id) => ok(id, 'addon'));
  };

  const oneAddonPerGroup = (addonIds, productsById) => {
    const groups = addonIds.map((id) => product(productsById, id).addonGroup).filter((g) => g != null);
    return new Set(groups).size === groups.length;
  };

  // O combo do dia mudou? Mesmas vagas (ordem e tipo) e cada escolha dentro dos produtos permitidos da vaga.
  const comboFits = (line, productsById) => {
    const combo = comboOf(line, productsById);
    const ok = (id, kind) => product(productsById, id)?.kind === kind;
    return line.slots.length === combo.slots.length && line.slots.every((choice, i) => {
      const slot = combo.slots[i];
      if (choice.kind !== slot.kind) return false;
      if (choice.kind === 'drink') return slot.productIds.includes(choice.productId) && ok(choice.productId, 'drink');
      return choice.flavorIds.every((id) => slot.productIds.includes(id) && ok(id, 'pizza'))
        && oneAddonPerGroup(choice.addonIds, productsById);
    });
  };

  // Estrutura válida + todos os ids existem com o kind certo + no máximo 1 addon por addonGroup.
  const isValid = (line, productsById) => {
    if (!priceable(line, productsById)) return false;
    if (line.kind === 'combo') return comboFits(line, productsById);
    if (line.kind === 'drink') return true;
    return oneAddonPerGroup(line.addonIds, productsById);
  };

  const isUnavailable = (line, productsById) => {
    let ids;
    if (line.kind === 'combo') {
      if (comboOf(line, productsById)?.available === false) return true;
      ids = line.slots.flatMap((s) => (s.kind === 'drink' ? [s.productId] : [...s.flavorIds, ...s.addonIds]));
    } else {
      ids = line.kind === 'drink' ? [line.productId] : [...line.flavorIds, ...line.addonIds];
    }
    return ids.some((id) => product(productsById, id)?.available === false);
  };

  return {
    getItems: () => items,
    count: () => items.reduce((n, l) => n + l.quantity, 0),

    add(item) {
      const next = normalize(item);
      if (!hasValidShape(next)) return { ok: false, reason: 'INVALID_ITEM' };
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
      if (p.kind === 'combo') return calcComboUnitCents(p.combo, p.addons);
      return p.kind === 'drink' ? p.product.priceCents : calcPizzaUnitCents(p.flavors, p.addons);
    },
    subtotalCents: (productsById) => calcOrderSubtotalCents(
      items.filter((l) => priceable(l, productsById)).map((l) => toPricingItem(l, productsById)),
    ),

    describe(line, productsById) {
      const name = (id) => productsById.get(id)?.name ?? 'Item indisponível';
      if (line.kind === 'combo') return comboOf(line, productsById)?.name ?? 'Combo indisponível';
      if (line.kind === 'drink') return name(line.productId);
      return describePizza(line.flavorIds, productsById);
    },

    /** Linhas de detalhe (texto menor) sob o nome da linha: adicionais da pizza ou escolhas do combo. */
    details(line, productsById) {
      const name = (id) => productsById.get(id)?.name;
      const addons = (ids) => ids.map(name).filter(Boolean).map((n) => `+ ${n}`);
      if (line.kind === 'pizza') return addons(line.addonIds);
      if (line.kind !== 'combo') return [];
      const combo = comboOf(line, productsById);
      const descriptions = describeComboSlots(combo, line.slots, productsById);
      return line.slots.flatMap((s, i) => [
        `${combo?.slots?.[i]?.label ?? 'Item'}: ${descriptions[i]}`,
        ...(s.kind === 'pizza' ? addons(s.addonIds) : []),
      ]);
    },

    isLineUnavailable: (line, productsById) => isUnavailable(line, productsById),

    /** Itens no formato do body de POST /api/orders (sem key, sem preço). */
    toOrderItems: () => items.map(({ key, ...item }) => ({ ...item })),

    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
}
