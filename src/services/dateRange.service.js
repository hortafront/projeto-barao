import { AppError } from '../errors/AppError.js';
import { getLocalParts } from './hours.service.js';

const MAX_SPAN_DAYS = 366;
const DAY_MS = 86_400_000;
const pad = (n, len = 2) => String(n).padStart(len, '0');
const toUtcMs = (ymd) => Date.parse(`${ymd}T00:00:00Z`);

function invalid(message, path) {
  return new AppError('VALIDATION_ERROR', 400, message, [{ path, message }]);
}

/**
 * Intervalo de dias LOCAIS ('YYYY-MM-DD', inclusive) usado por listOrders/getOrdersSummary.
 * Sem parâmetros → hoje local; só um dos dois → o outro é igual a ele.
 */
export function resolveLocalDateRange({ from, to } = {}, { now, timeZone } = {}) {
  let start = from ?? to;
  let end = to ?? from;
  if (!start) {
    const p = getLocalParts(now(), timeZone);
    start = `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
    end = start;
  }
  if (start > end) throw invalid('A data inicial deve ser anterior ou igual à final.', 'from');
  if ((toUtcMs(end) - toUtcMs(start)) / DAY_MS > MAX_SPAN_DAYS) {
    throw invalid('Período máximo de 366 dias.', 'to');
  }
  return { from: start, to: end };
}

/** Pedido do repo (aninhado) → item plano da lista do admin (spec 5.4). */
export function toAdminOrderListItem(order) {
  return {
    id: order.id,
    code: order.code,
    createdAt: order.createdAt,
    customerName: order.customer.name,
    customerPhone: order.customer.phone,
    fulfillment: order.fulfillment,
    paymentMethod: order.payment.method,
    subtotalCents: order.subtotalCents,
    status: order.status,
  };
}

/** Pedido do repo (aninhado) → detalhe plano, camelCase das colunas de orders + items. */
export function toAdminOrderDetail(order) {
  return {
    id: order.id,
    code: order.code,
    status: order.status,
    createdAt: order.createdAt,
    customerName: order.customer.name,
    customerPhone: order.customer.phone,
    fulfillment: order.fulfillment,
    addressStreet: order.address?.street ?? null,
    addressNumber: order.address?.number ?? null,
    addressDistrict: order.address?.district ?? null,
    addressReference: order.address?.reference ?? null,
    paymentMethod: order.payment.method,
    changeForCents: order.payment.changeForCents ?? null,
    notes: order.notes ?? null,
    subtotalCents: order.subtotalCents,
    items: order.items,
  };
}
