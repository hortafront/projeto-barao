import { AppError } from '../errors/AppError.js';
import { getLocalParts } from './hours.service.js';

export const WEEKDAY_NAMES = Object.freeze([
  'domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado',
]);

/** Dia da semana (0 = domingo) no fuso da loja. */
export function todayWeekday(now, timeZone) {
  return getLocalParts(now, timeZone).weekday;
}

/**
 * Combo de hoje na forma pública, ou null. `productsById` = Map dos produtos públicos (id -> produto):
 * ids que não estão lá (excluídos) saem das vagas. `available` = combo ligado e toda vaga com ≥ 1 produto disponível.
 */
export async function getTodayPublicCombo(db, { now, timeZone, productsById }) {
  const combo = await db.getTodayCombo(todayWeekday(now, timeZone));
  if (!combo) return null;
  const slots = combo.slots.map((s) => ({
    id: s.id,
    position: s.position,
    label: s.label,
    kind: s.kind,
    productIds: s.productIds.filter((id) => productsById.has(id)),
  }));
  const everySlotHasStock = slots.every((s) => s.productIds.some((id) => productsById.get(id).available));
  return {
    id: combo.id,
    name: combo.name,
    description: combo.description,
    priceCents: combo.priceCents,
    imageUrl: combo.imageUrl,
    available: Boolean(combo.available) && everySlotHasStock,
    slots,
  };
}

const invalid = (path, message) => new AppError('VALIDATION_ERROR', 400, message, [{ path, message }]);

/** Regras de cadastro que dependem do banco (o formato já foi validado pelo schema). */
export async function assertComboInput(db, input, { excludeId = null } = {}) {
  const others = (await db.listCombos()).filter((c) => c.id !== excludeId);
  for (const day of input.weekdays) {
    const clash = others.find((c) => c.weekdays.includes(day));
    if (clash) throw invalid('weekdays', `Já existe um combo na ${WEEKDAY_NAMES[day]}: ${clash.name}.`);
  }

  const ids = [...new Set(input.slots.flatMap((s) => s.productIds))];
  const byId = new Map((await db.getProductsByIds(ids)).map((p) => [p.id, p]));
  for (const [i, slot] of input.slots.entries()) {
    for (const id of slot.productIds) {
      const product = byId.get(id);
      if (!product || product.kind !== slot.kind) {
        throw invalid(`slots.${i}.productIds`, `${product?.name ?? 'Produto'} não pode ser usado nesta vaga.`);
      }
    }
  }
}
