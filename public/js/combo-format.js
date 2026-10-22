// Descrições do combo, puras (sem DOM): iguais às que o servidor grava no pedido.
const nameOf = (productsById, id) => productsById.get(id)?.name ?? 'Item indisponível';

/** "Pizza X" ou "Pizza meio a meio: A / B". */
export function describePizza(flavorIds, productsById) {
  return flavorIds.length === 2
    ? `Pizza meio a meio: ${flavorIds.map((id) => nameOf(productsById, id)).join(' / ')}`
    : `Pizza ${nameOf(productsById, flavorIds[0])}`;
}

/** Uma descrição por vaga: pizza ou nome da bebida. */
export function describeComboSlots(_combo, slots, productsById) {
  return slots.map((slot) => (slot.kind === 'drink'
    ? nameOf(productsById, slot.productId)
    : describePizza(slot.flavorIds, productsById)));
}
