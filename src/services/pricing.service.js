import { AppError } from '../errors/AppError.js';
import { calcPizzaBaseCents, calcPizzaUnitCents, calcComboUnitCents, calcItemCents } from '../../shared/pricing.js';

export function collectProductIds(items) {
  const ids = new Set();
  for (const item of items) {
    if (item.kind === 'pizza') {
      item.flavorIds.forEach((id) => ids.add(id));
      (item.addonIds ?? []).forEach((id) => ids.add(id));
    } else if (item.kind === 'combo') {
      for (const slot of item.slots) {
        if (slot.kind === 'pizza') {
          slot.flavorIds.forEach((id) => ids.add(id));
          (slot.addonIds ?? []).forEach((id) => ids.add(id));
        } else {
          ids.add(slot.productId);
        }
      }
    } else {
      ids.add(item.productId);
    }
  }
  return [...ids];
}

export function collectComboIds(items) {
  return [...new Set(items.filter((i) => i.kind === 'combo').map((i) => i.comboId))];
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
  if (names.length === 0) return 'Ops! Alguns itens acabaram por hoje. Remova do carrinho para continuar.';
  if (names.length === 1) return `Ops! ${names[0]} acabou por hoje. Remova do carrinho para continuar.`;
  const list = `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
  return `Ops! ${list} acabaram por hoje. Remova do carrinho para continuar.`;
}

export function priceOrderItems(items, productsById, { combosById = new Map(), weekday } = {}) {
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

  const resolveCombo = (item, i) => {
    const combo = combosById.get(item.comboId);
    if (!combo) throw new AppError('PRODUCT_UNAVAILABLE', 409, 'Este combo não está mais disponível.');
    if (!combo.available || !combo.weekdays.includes(weekday)) {
      throw new AppError('PRODUCT_UNAVAILABLE', 409, `O ${combo.name} não está disponível hoje.`);
    }
    const vagas = combo.slots;
    if (item.slots.length !== vagas.length || vagas.some((v, j) => v.kind !== item.slots[j].kind)) {
      throw invalid('As escolhas não correspondem às vagas do combo.', `items.${i}.slots`);
    }
    const slots = item.slots.map((slot, j) => {
      const vaga = vagas[j];
      const base = `items.${i}.slots.${j}`;
      if (slot.kind === 'drink') {
        if (!vaga.productIds.includes(slot.productId)) throw invalid('Produto não permitido nesta vaga do combo.', `${base}.productId`);
        return { vaga, flavors: null, addons: [], product: resolve(slot.productId, 'drink', `${base}.productId`) };
      }
      const addonIds = slot.addonIds ?? [];
      if (new Set(slot.flavorIds).size !== slot.flavorIds.length) throw invalid('Escolha dois sabores diferentes para o meio a meio.', `${base}.flavorIds`);
      if (slot.flavorIds.some((id) => !vaga.productIds.includes(id))) throw invalid('Sabor não permitido nesta vaga do combo.', `${base}.flavorIds`);
      if (new Set(addonIds).size !== addonIds.length) throw invalid('Cada adicional só pode ser escolhido uma vez por pizza.', `${base}.addonIds`);
      return {
        vaga,
        flavors: slot.flavorIds.map((id) => resolve(id, 'pizza', `${base}.flavorIds`)),
        addons: addonIds.map((id) => resolve(id, 'addon', `${base}.addonIds`)),
        product: null,
      };
    });
    return { item, combo, slots };
  };

  const resolved = items.map((item, i) => {
    if (item.kind === 'combo') return resolveCombo(item, i);
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

  resolved.forEach(({ item, addons, slots }, i) => {
    if (item.kind === 'pizza') assertOneAddonPerGroup(addons, `items.${i}.addonIds`);
    if (item.kind === 'combo') slots.forEach((s, j) => { if (s.flavors) assertOneAddonPerGroup(s.addons, `items.${i}.slots.${j}.addonIds`); });
  });

  return resolved.map(({ item, flavors, addons, product, combo, slots }) => {
    if (item.kind === 'combo') {
      const allAddons = slots.flatMap((s) => s.addons);
      const choices = slots.map((s) => {
        const names = s.flavors?.map((f) => f.name);
        return {
          label: s.vaga.label, kind: s.vaga.kind,
          description: s.product ? s.product.name : names.length === 2 ? `Pizza meio a meio: ${names[0]} / ${names[1]}` : `Pizza ${names[0]}`,
          addons: s.addons.map((a) => ({ name: a.name, priceCents: a.priceCents })),
        };
      });
      const priced = {
        kind: 'combo', comboId: combo.id, quantity: item.quantity, combo, description: combo.name, choices,
        addons: allAddons.map((a) => ({ name: a.name, priceCents: a.priceCents })),
        productIds: slots.flatMap((s) => [...(s.flavors ?? [s.product]), ...s.addons].map((p) => p.id)),
        flavorNames: null, baseUnitCents: combo.priceCents,
        unitPriceCents: calcComboUnitCents(combo, allAddons),
        notes: item.notes?.trim() || null,
      };
      return { ...priced, lineTotalCents: calcItemCents(priced) };
    }
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
