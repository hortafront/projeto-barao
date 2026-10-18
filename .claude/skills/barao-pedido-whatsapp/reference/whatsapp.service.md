# Referência — `src/services/whatsapp.service.js`

Entrada de `buildOrderMessage(order)`:
```
{
  code: 'BR-0427',
  items: pricedItems,            // saída de priceOrderItems (barao-cardapio-precos)
  subtotalCents,
  customer: { name, phone },     // phone só dígitos
  fulfillment: 'delivery' | 'pickup',
  address: { street, number, district, reference } | null,
  payment: { method: 'pix'|'cash'|'card', changeForCents: number|null },
  notes: string | null
}
```
Usa de cada item: `kind`, `quantity`, `description`, `baseUnitCents`, `addons[{ name, priceCents }]`, `lineTotalCents`, `notes`.

```js
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
```

## Teste de referência (pedido do contrato)
```js
// tests/unit/whatsapp.service.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrderMessage, buildWhatsAppUrl, formatPhoneBR } from '../../src/services/whatsapp.service.js';

const order = {
  code: 'BR-0427',
  subtotalCents: 5949,
  customer: { name: 'João Silva', phone: '85999999999' },
  fulfillment: 'delivery',
  address: { street: 'Rua X', number: '123', district: 'Bairro Y', reference: 'perto da praça' },
  payment: { method: 'cash', changeForCents: 10000 },
  notes: '...',
  items: [
    { kind: 'pizza', quantity: 1, description: 'Pizza meio a meio: Calabresa / Frango',
      baseUnitCents: 3499, addons: [{ name: 'Borda Recheada com Catupiry', priceCents: 450 }],
      lineTotalCents: 3949, notes: 'sem cebola' },
    { kind: 'drink', quantity: 2, description: 'Coca-Cola 1 Litro Zero Açúcar',
      baseUnitCents: 1000, addons: [], lineTotalCents: 2000, notes: null },
  ],
};

test('mensagem bate com o contrato', () => {
  assert.equal(buildOrderMessage(order), [
    '🍕 *Pedido BR-0427 — Barão Delivery de Pizza*',
    '',
    '*Itens*',
    '1x Pizza meio a meio: Calabresa / Frango — R$ 34,99',
    '   + Borda Recheada com Catupiry — R$ 4,50',
    '   Obs.: sem cebola',
    '2x Coca-Cola 1 Litro Zero Açúcar — R$ 20,00',
    '',
    '*Subtotal:* R$ 59,49',
    '_Taxa de entrega a combinar_',
    '',
    '*Cliente:* João Silva — (85) 99999-9999',
    '*Entrega:* Rua X, 123 — Bairro Y',
    'Ref.: perto da praça',
    '*Pagamento:* Dinheiro — troco para R$ 100,00',
    '*Observações:* ...',
  ].join('\n'));
});

test('retirada + pix, sem obs', () => {
  const msg = buildOrderMessage({ ...order, fulfillment: 'pickup', address: null,
    payment: { method: 'pix', changeForCents: null }, notes: null });
  assert.match(msg, /\n\*Retirada no balcão\*\n/);
  assert.doesNotMatch(msg, /Taxa de entrega|Entrega:|Ref\.:|Observações/);
  assert.match(msg, /\*Pagamento:\* Pix$/);
});

test('url usa encodeURIComponent', () => {
  const url = buildWhatsAppUrl('5585997687641', 'Olá *Barão*\n🍕');
  assert.equal(url, 'https://wa.me/5585997687641?text=Ol%C3%A1%20*Bar%C3%A3o*%0A%F0%9F%8D%95');
});

test('telefone', () => {
  assert.equal(formatPhoneBR('85999999999'), '(85) 99999-9999');
  assert.equal(formatPhoneBR('8532221111'), '(85) 3222-1111');
});
```
`encodeURIComponent` não codifica `*`, `_`, `-`, `.`, `!`, `~`, `'`, `(`, `)` — esperado e aceito pelo wa.me.
