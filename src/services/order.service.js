import { AppError } from '../errors/AppError.js';
import { calcOrderSubtotalCents } from '../../shared/pricing.js';
import { getStoreStatus, describeNextOpening } from './hours.service.js';
import { collectProductIds, priceOrderItems, assertChangeIsValid } from './pricing.service.js';
import { buildOrderMessage, buildWhatsAppUrl } from './whatsapp.service.js';

export async function createOrder(input, { db, now = new Date(), timeZone = 'America/Fortaleza', customerId }) {
  const [hours, settings] = await Promise.all([db.getHours(), db.getSettings()]);
  const status = getStoreStatus(now, hours, settings.storeOverride, timeZone);
  if (!status.open) {
    if (status.nextOpenAt) {
      throw new AppError('STORE_CLOSED', 409,
        `Estamos fechados agora. Abrimos ${describeNextOpening(status.nextOpenAt, now, timeZone)}.`,
        [{ nextOpenAt: status.nextOpenAt }]);
    }
    throw new AppError('STORE_CLOSED', 409, 'Estamos fechados no momento.');
  }

  const profile = await db.getCustomer(customerId);
  if (!profile) {
    const msg = 'Complete seu perfil antes de fazer o pedido.';
    throw new AppError('VALIDATION_ERROR', 400, msg, [{ path: 'profile', message: msg }]);
  }

  const products = await db.getProductsByIds(collectProductIds(input.items));
  const pricedItems = priceOrderItems(input.items, new Map(products.map((p) => [p.id, p])));
  const subtotalCents = calcOrderSubtotalCents(pricedItems);

  const isCash = input.payment.method === 'cash';
  const payment = { method: input.payment.method, changeForCents: isCash ? input.payment.changeForCents ?? null : null };
  assertChangeIsValid(payment, subtotalCents);

  const draft = {
    customerId,
    customer: input.customer,
    fulfillment: input.fulfillment,
    address: input.fulfillment === 'delivery' ? input.address : null,
    payment,
    notes: input.notes?.trim() || null,
    subtotalCents,
    items: pricedItems,
  };
  const saved = await db.createOrder(draft);

  const message = buildOrderMessage({ ...draft, code: saved.code });
  const whatsappUrl = buildWhatsAppUrl(settings.whatsappNumber, message);
  return { code: saved.code, subtotalCents, message, whatsappUrl };
}
