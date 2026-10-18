// Implementação de referência de public/js/cart.js
// O carrinho guarda SÓ ids, quantidades, opções e observações — nunca preço nem nome.
// Preço e nome vêm sempre do /api/menu (via productsById) e são recalculados com /shared/pricing.js.
import { calcPizzaUnitCents, calcItemCents, calcOrderSubtotalCents } from '/shared/pricing.js';

export const STORAGE_KEY = 'barao:cart:v1';
export const MAX_LINES = 30;
export const MAX_QTY = 20;

/**
 * Linha do carrinho = item do body de POST /api/orders + um `lineId` local:
 *   { lineId, kind: 'pizza', flavorIds: [id] | [id, id], addonIds: [id...], quantity, notes }
 *   { lineId, kind: 'drink', productId, quantity }
 */
let lines = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    return Array.isArray(data?.lines) ? data.lines : [];
  } catch {
    return []; // modo privado / JSON corrompido: começa vazio
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ lines }));
  } catch { /* storage cheio/bloqueado: carrinho segue só em memória */ }
  for (const fn of listeners) fn(lines);
}

export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const getLines = () => lines;
export const count = () => lines.reduce((n, l) => n + l.quantity, 0);

const newId = () => globalThis.crypto?.randomUUID?.() ?? `l${Date.now()}${Math.random().toString(36).slice(2)}`;

// Mesma pizza (sabores + addons + obs.) soma quantidade em vez de duplicar linha.
const sameConfig = (a, b) =>
  a.kind === b.kind &&
  (a.kind === 'drink'
    ? a.productId === b.productId
    : [...a.flavorIds].sort().join() === [...b.flavorIds].sort().join() &&
      [...a.addonIds].sort().join() === [...b.addonIds].sort().join() &&
      (a.notes ?? '') === (b.notes ?? ''));

export function addLine(item) {
  const existing = lines.find((l) => sameConfig(l, item));
  if (existing) {
    existing.quantity = Math.min(MAX_QTY, existing.quantity + item.quantity);
  } else {
    if (lines.length >= MAX_LINES) throw new Error('CART_FULL');
    lines = [...lines, { ...item, lineId: newId() }];
  }
  persist();
}

export function setQuantity(lineId, quantity) {
  lines = quantity < 1
    ? lines.filter((l) => l.lineId !== lineId)
    : lines.map((l) => (l.lineId === lineId ? { ...l, quantity: Math.min(MAX_QTY, quantity) } : l));
  persist();
}

export const removeLine = (lineId) => setQuantity(lineId, 0);
export function clear() { lines = []; persist(); }

/** Índice id -> produto a partir da resposta de GET /api/menu. */
export function indexMenu(menu) {
  const byId = new Map();
  for (const category of menu.categories) {
    for (const product of category.products) byId.set(product.id, product);
  }
  return byId;
}

/**
 * Revalida o carrinho contra o cardápio atual. Remove linhas com produto inexistente,
 * esgotado (available=false) ou de tipo errado. Retorna os nomes removidos para avisar o cliente.
 */
export function revalidate(productsById) {
  const removed = [];
  const ok = (id, kind) => {
    const p = productsById.get(id);
    return Boolean(p && p.available && p.kind === kind);
  };
  const valid = lines.filter((l) => {
    const good = l.kind === 'drink'
      ? ok(l.productId, 'drink')
      : l.flavorIds.length >= 1 && l.flavorIds.length <= 2 &&
        new Set(l.flavorIds).size === l.flavorIds.length &&
        l.flavorIds.every((id) => ok(id, 'pizza')) &&
        l.addonIds.every((id) => ok(id, 'addon'));
    if (!good) removed.push(describeLine(l, productsById));
    return good;
  });
  if (valid.length !== lines.length) { lines = valid; persist(); }
  return removed;
}

// ---- Preço: ÚNICO ponto que fala com shared/pricing.js (assinaturas da skill barao-cardapio-precos):
// ----   calcPizzaUnitCents(flavors, addons)   flavors/addons: [{ priceCents }]
// ----   calcItemCents(item)  pizza: { kind, flavors, addons, quantity } | drink: { kind, product, quantity }
// ----   calcOrderSubtotalCents(items)
// ---- Chamar só depois de revalidate() (ids garantidamente existentes e disponíveis).
function toPricingItem(line, productsById) {
  const product = (id) => productsById.get(id);
  return line.kind === 'drink'
    ? { kind: 'drink', product: product(line.productId), quantity: line.quantity }
    : { kind: 'pizza', flavors: line.flavorIds.map(product), addons: line.addonIds.map(product), quantity: line.quantity };
}

export const unitCents = (line, productsById) => {
  const item = toPricingItem(line, productsById);
  return item.kind === 'drink' ? item.product.priceCents : calcPizzaUnitCents(item.flavors, item.addons);
};

export const lineTotalCents = (line, productsById) => calcItemCents(toPricingItem(line, productsById));

export function subtotalCents(productsById) {
  return calcOrderSubtotalCents(lines.map((l) => toPricingItem(l, productsById)));
}

export function describeLine(line, productsById) {
  const name = (id) => productsById.get(id)?.name ?? 'Item indisponível';
  if (line.kind === 'drink') return name(line.productId);
  return line.flavorIds.length === 2
    ? `Pizza meio a meio: ${line.flavorIds.map(name).join(' / ')}`
    : `Pizza ${name(line.flavorIds[0])}`;
}

/** Itens no formato exato do body de POST /api/orders (sem lineId, sem preço). */
export function toOrderItems() {
  return lines.map(({ lineId, ...item }) => item);
}
