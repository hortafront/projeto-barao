# Referência — `src/services/pricing.service.js`

Entrada: `items` já validados pelo Zod (`createOrderSchema`, ver skill `barao-api-express`) e um `Map` id → produto vindo de `db.getProductsByIds(ids)`.

Produto (forma de domínio devolvida pelos repositories, camelCase):
`{ id, categoryId, kind: 'pizza'|'drink'|'addon', name, description, priceCents, imageUrl, available, sortOrder }`

Item precificado (saída de `priceOrderItems`) — serve ao mesmo tempo para `calcItemCents`/`calcOrderSubtotalCents`, para o snapshot em `order_items` e para `buildOrderMessage`:
```
{
  kind: 'pizza' | 'drink',
  quantity,
  flavors, addons, product,         // formato aceito por shared/pricing.js (addons = produtos: { id, name, priceCents, ... })
  description,                      // "Pizza Calabresa" | "Pizza meio a meio: Calabresa / Frango" | "Coca-Cola 1 Litro"
  productIds: string[],             // sabores (ou a bebida) + addons → order_items.product_ids
  flavorNames: string[] | null,     // null em bebida
                                    // addons → order_items.addons como [{ name, priceCents }] ([] em bebida/sem addon)
  baseUnitCents,                    // pizza: sabor mais caro; bebida: preço da bebida
  unitPriceCents,                   // base + addons
  lineTotalCents,                   // unitPriceCents * quantity
  notes: string | null              // só pizza
}
```

```js
// src/services/pricing.service.js
import { AppError } from '../errors/AppError.js';
import { calcPizzaBaseCents, calcPizzaUnitCents, calcItemCents } from '../../shared/pricing.js';
import { formatBRL } from '../../shared/money.js';

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
    throw new AppError('PRODUCT_UNAVAILABLE', 409,
      'Alguns itens não estão mais disponíveis. Revise seu carrinho.', [...unavailable.values()]);
  }

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
    throw invalid(`O troco precisa ser para um valor igual ou maior que o total (${formatBRL(totalCents)}).`,
      'payment.changeForCents');
  }
}
```

Notas
- A ordem dos sabores na descrição é a ordem enviada pelo cliente (`flavorIds`).
- Indisponíveis são acumulados e reportados de uma vez (melhor UX que falhar no primeiro).
- `payment.changeForCents` de quem não paga em dinheiro é descartado pelo `order.service` (vira `null`).
