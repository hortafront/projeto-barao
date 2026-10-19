import { AppError } from '../errors/AppError.js';
import { calcPizzaBaseCents, calcPizzaUnitCents, calcItemCents } from '../../shared/pricing.js';

export function collectProductIds(items) {
  const ids = new Set();
  for (const item of items) {
    if (item.kind === 'pizza') {
      item.flavorIds.forEach((id) => ids.add(id));
      (item.addonIds ?? []).forEach((id) => ids.add(id));
    } else {
      ids.add(item.productId);
    }
  }
  return [...ids];
}

function invalid(message, path = 'items') {
  return new AppError('VALIDATION_ERROR', 400, message, [{ path, message }]);
}

const ADDON_GROUP_MESSAGES = Object.freeze({ borda: 'Escolha apenas uma borda por pizza.' });

/** No máximo 1 addon por addonGroup não nulo (ex.: uma borda só). Addons sem grupo combinam com tudo. */
function assertOneAddonPerGroup(addons, path) {
  const seen = new Set();
  for (const a of addons) {
    if (a.addonGroup == null) continue;
    if (seen.has(a.addonGroup)) {
      throw invalid(ADDON_GROUP_MESSAGES[a.addonGroup] ?? `Escolha apenas um adicional do grupo "${a.addonGroup}" por pizza.`, path);
    }
    seen.add(a.addonGroup);
  }
}

function unavailableMessage(entries) {
  const names = entries.map((e) => e.name).filter((n) => n != null);
  return names.length > 0
    ? `Ops! ${names.join(', ')} acabou por hoje. Remova do carrinho para continuar.`
    : 'Ops! Alguns itens acabaram por hoje. Remova do carrinho para continuar.';
}

export function priceOrderItems(items, productsById) {
  const unavailable = new Map(); // id -> { productId, name }

  const resolve = (id, expectedKind, path) => {
    const p = productsById.get(id);
    if (!p || !p.available) {
      unavailable.set(id, { productId: id, name: p?.name ?? null });
      return null;
    }
    if (p.kind !== expectedKind) throw invalid(`"${p.name}" não pode ser usado aqui.`, path);
    return p;
  };

  const resolved = items.map((item, i) => {
    if (item.kind === 'pizza') {
      const addonIds = item.addonIds ?? [];
      if (new Set(item.flavorIds).size !== item.flavorIds.length) throw invalid('Escolha dois sabores diferentes para o meio a meio.', `items.${i}.flavorIds`);
      if (new Set(addonIds).size !== addonIds.length) throw invalid('Cada adicional só pode ser escolhido uma vez por pizza.', `items.${i}.addonIds`);
      return {
        item,
        flavors: item.flavorIds.map((id) => resolve(id, 'pizza', `items.${i}.flavorIds`)),
        addons: addonIds.map((id) => resolve(id, 'addon', `items.${i}.addonIds`)),
      };
    }
    return { item, product: resolve(item.productId, 'drink', `items.${i}.productId`) };
  });

  if (unavailable.size > 0) {
    const entries = [...unavailable.values()];
    throw new AppError('PRODUCT_UNAVAILABLE', 409, unavailableMessage(entries), entries);
  }

  resolved.forEach(({ item, addons }, i) => {
    if (item.kind === 'pizza') assertOneAddonPerGroup(addons, `items.${i}.addonIds`);
  });

  return resolved.map(({ item, flavors, addons, product }) => {
    if (item.kind === 'pizza') {
      const flavorNames = flavors.map((f) => f.name);
      const priced = {
        kind: 'pizza', quantity: item.quantity, flavors, addons, product: null,
        description: flavorNames.length === 2
          ? `Pizza meio a meio: ${flavorNames[0]} / ${flavorNames[1]}`
          : `Pizza ${flavorNames[0]}`,
        productIds: [...flavors, ...addons].map((p) => p.id),
        flavorNames,
        baseUnitCents: calcPizzaBaseCents(flavors),
        unitPriceCents: calcPizzaUnitCents(flavors, addons),
        notes: item.notes?.trim() || null,
      };
      return { ...priced, lineTotalCents: calcItemCents(priced) };
    }
    const priced = {
      kind: 'drink', quantity: item.quantity, flavors: null, addons: [], product,
      description: product.name, productIds: [product.id], flavorNames: null,
      baseUnitCents: product.priceCents, unitPriceCents: product.priceCents, notes: null,
    };
    return { ...priced, lineTotalCents: calcItemCents(priced) };
  });
}

/** Troco só faz sentido em dinheiro; se informado, precisa ser >= total. */
export function assertChangeIsValid(payment, totalCents) {
  if (payment.method !== 'cash' || payment.changeForCents == null) return;
  if (payment.changeForCents < totalCents) {
    throw invalid('O troco deve ser para um valor igual ou maior que o total do pedido.',
      'payment.changeForCents');
  }
}
