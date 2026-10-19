// shared/pricing.js — ES module puro, sem dependências (Node + browser)
export const LIMITS = Object.freeze({
  minFlavors: 1, maxFlavors: 2, minQuantity: 1, maxQuantity: 20, maxItems: 30,
});

function assertCents(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label}: centavos inválidos (${value})`);
  }
}

function assertQuantity(q) {
  if (!Number.isInteger(q) || q < LIMITS.minQuantity || q > LIMITS.maxQuantity) {
    throw new RangeError(`quantidade inválida (${q}); permitido ${LIMITS.minQuantity}–${LIMITS.maxQuantity}`);
  }
}

/** Preço base da pizza = sabor mais caro. flavors: [{ priceCents }] */
export function calcPizzaBaseCents(flavors) {
  if (!Array.isArray(flavors) || flavors.length < LIMITS.minFlavors || flavors.length > LIMITS.maxFlavors) {
    throw new RangeError('pizza precisa de 1 ou 2 sabores');
  }
  flavors.forEach((f) => assertCents(f?.priceCents, 'sabor'));
  return Math.max(...flavors.map((f) => f.priceCents));
}

/** Unitário = max(preço dos sabores) + soma dos addons. addons: [{ priceCents }] */
export function calcPizzaUnitCents(flavors, addons = []) {
  const base = calcPizzaBaseCents(flavors);
  return addons.reduce((sum, a) => {
    assertCents(a?.priceCents, 'adicional');
    return sum + a.priceCents;
  }, base);
}

/**
 * Total da linha.
 * pizza: { kind: 'pizza', flavors: [{priceCents}], addons: [{priceCents}], quantity }
 * drink: { kind: 'drink', product: { priceCents }, quantity }
 */
export function calcItemCents(item) {
  assertQuantity(item?.quantity);
  let unit;
  if (item.kind === 'pizza') unit = calcPizzaUnitCents(item.flavors, item.addons ?? []);
  else if (item.kind === 'drink') { assertCents(item.product?.priceCents, 'bebida'); unit = item.product.priceCents; }
  else throw new TypeError(`kind de item inválido: ${item.kind}`);
  return unit * item.quantity;
}

export function calcOrderSubtotalCents(items) {
  return items.reduce((sum, item) => sum + calcItemCents(item), 0);
}
