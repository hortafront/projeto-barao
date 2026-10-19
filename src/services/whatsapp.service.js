// src/services/whatsapp.service.js
import { formatBRL } from '../../shared/money.js';

const PAYMENT_LABEL = Object.freeze({ pix: 'Pix', card: 'Cartão (maquininha)', cash: 'Dinheiro' });

/** Colapsa quebras de linha/espaços de texto livre para não quebrar o layout. */
export function oneLine(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/** '85999999999' -> '(85) 99999-9999' | '8532221111' -> '(85) 3222-1111' */
export function formatPhoneBR(phone) {
  const d = String(phone ?? '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(phone ?? '');
}

function itemLines(item) {
  const q = item.quantity;
  if (item.kind === 'pizza') {
    const lines = [`${q}x ${item.description} — ${formatBRL(item.baseUnitCents * q)}`];
    for (const addon of item.addons ?? []) {
      lines.push(`   + ${addon.name} — ${formatBRL(addon.priceCents * q)}`);
    }
    const notes = oneLine(item.notes);
    if (notes) lines.push(`   Obs.: ${notes}`);
    return lines;
  }
  return [`${q}x ${item.description} — ${formatBRL(item.lineTotalCents)}`];
}

function paymentText({ method, changeForCents }) {
  if (method === 'cash' && changeForCents != null) {
    return `Dinheiro — troco para ${formatBRL(changeForCents)}`;
  }
  return PAYMENT_LABEL[method];
}

export function buildOrderMessage(order) {
  const lines = [`🍕 *Pedido ${order.code} — Barão Delivery de Pizza*`, '', '*Itens*'];
  for (const item of order.items) lines.push(...itemLines(item));

  lines.push('', `*Subtotal:* ${formatBRL(order.subtotalCents)}`);
  if (order.fulfillment === 'delivery') lines.push('_Taxa de entrega a combinar_');

  lines.push('', `*Cliente:* ${oneLine(order.customer.name)} — ${formatPhoneBR(order.customer.phone)}`);
  if (order.fulfillment === 'delivery') {
    const a = order.address;
    lines.push(`*Entrega:* ${oneLine(a.street)}, ${oneLine(a.number)} — ${oneLine(a.district)}`);
    const ref = oneLine(a.reference);
    if (ref) lines.push(`Ref.: ${ref}`);
  } else {
    lines.push('*Retirada no balcão*');
  }

  lines.push(`*Pagamento:* ${paymentText(order.payment)}`);
  const notes = oneLine(order.notes);
  if (notes) lines.push(`*Observações:* ${notes}`);
  return lines.join('\n');
}

/** number: só dígitos com DDI (ex.: '5585997687641'). */
export function buildWhatsAppUrl(number, text) {
  const digits = String(number ?? '').replace(/\D/g, '');
  if (!/^\d{12,13}$/.test(digits)) throw new Error('whatsapp_number inválido em settings');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
