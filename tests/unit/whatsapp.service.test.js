import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOrderMessage,
  buildWhatsAppUrl,
  formatPhoneBR,
  oneLine,
} from '../../src/services/whatsapp.service.js';

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
  const url = buildWhatsAppUrl('5585992732247', 'Olá *Barão*\n🍕');
  assert.equal(url, 'https://wa.me/5585992732247?text=Ol%C3%A1%20*Bar%C3%A3o*%0A%F0%9F%8D%95');
});

test('telefone', () => {
  assert.equal(formatPhoneBR('85999999999'), '(85) 99999-9999');
  assert.equal(formatPhoneBR('8532221111'), '(85) 3222-1111');
});

test('entrega + cartão sem referência: sem Ref.', () => {
  const msg = buildOrderMessage({
    ...order,
    address: { ...order.address, reference: '' },
    payment: { method: 'card', changeForCents: null },
  });
  assert.ok(msg.includes('*Pagamento:* Cartão (maquininha)'));
  assert.ok(!msg.includes('Ref.:'));
});

test('dinheiro sem troco: linha exata', () => {
  const msg = buildOrderMessage({ ...order, payment: { method: 'cash', changeForCents: null } });
  assert.ok(msg.split('\n').includes('*Pagamento:* Dinheiro'));
});

test('pizza com quantidade 2 multiplica base e adicional', () => {
  const msg = buildOrderMessage({
    ...order,
    subtotalCents: 7898,
    items: [{ kind: 'pizza', quantity: 2, description: 'Pizza Calabresa',
      baseUnitCents: 3499, addons: [{ name: 'Borda Recheada com Catupiry', priceCents: 450 }],
      lineTotalCents: 7898, notes: null }],
  });
  const lines = msg.split('\n');
  assert.ok(lines.includes('2x Pizza Calabresa — R$ 69,98'));
  assert.ok(lines.includes('   + Borda Recheada com Catupiry — R$ 9,00'));
});

test('oneLine colapsa espaços e preserva * e _', () => {
  assert.equal(oneLine('  João\n\tda   Silva '), 'João da Silva');
  assert.equal(oneLine(null), '');
  assert.equal(oneLine('*a* _b_'), '*a* _b_');
});

test('endereço com quebra de linha vira uma única linha Entrega', () => {
  const msg = buildOrderMessage({
    ...order,
    address: { street: 'Rua\nX', number: '123', district: 'Bairro Y', reference: '' },
  });
  const entrega = msg.split('\n').filter((l) => l.startsWith('*Entrega:*'));
  assert.deepEqual(entrega, ['*Entrega:* Rua X, 123 — Bairro Y']);
});

test('buildWhatsAppUrl: roundtrip e número inválido', () => {
  const msg = buildOrderMessage(order);
  const url = buildWhatsAppUrl('5585992732247', msg);
  assert.equal(decodeURIComponent(url.split('?text=')[1]), msg);
  assert.throws(() => buildWhatsAppUrl('123', 'x'));
});

// --- combo do dia ---
const comboOrder = (items) => ({ ...order, items });
const comboItem = (over = {}) => ({
  kind: 'combo', quantity: 1, description: 'Combo Clássico',
  choices: [
    { label: 'Pizza 1', kind: 'pizza', description: 'Pizza meio a meio: Calabresa / Mussarela',
      addons: [{ name: 'Borda Recheada com Catupiry', priceCents: 450 }] },
    { label: 'Bebida', kind: 'drink', description: 'Coca-Cola 1 Litro', addons: [] },
  ],
  addons: [{ name: 'Borda Recheada com Catupiry', priceCents: 450 }],
  baseUnitCents: 3690, unitPriceCents: 4140, lineTotalCents: 4140, notes: 'sem\ncebola', ...over,
});
const itemsBlock = (msg) => {
  const all = msg.split('\n');
  return all.slice(3, all.indexOf('', 3));
};

test('combo quantidade 1: pizza, borda, bebida e obs', () => {
  assert.deepEqual(itemsBlock(buildOrderMessage(comboOrder([comboItem()]))), [
    '1x Combo Clássico — R$ 36,90',
    '   • Pizza meio a meio: Calabresa / Mussarela',
    '   + Borda Recheada com Catupiry — R$ 4,50',
    '   • Coca-Cola 1 Litro',
    '   Obs.: sem cebola',
  ]);
});

test('combo quantidade 2 multiplica base e adicionais', () => {
  const lines = itemsBlock(buildOrderMessage(comboOrder([
    comboItem({ quantity: 2, lineTotalCents: 8280, notes: null }),
  ])));
  assert.equal(lines[0], '2x Combo Clássico — R$ 73,80');
  assert.equal(lines[2], '   + Borda Recheada com Catupiry — R$ 9,00');
  assert.equal(lines.length, 4);
});

test('combo com duas pizzas: cada adicional logo abaixo da sua pizza', () => {
  const c = comboItem({ notes: null, choices: [
    { label: 'Pizza 1', kind: 'pizza', description: 'Pizza Calabresa',
      addons: [{ name: 'Borda Recheada com Catupiry', priceCents: 450 }] },
    { label: 'Pizza 2', kind: 'pizza', description: 'Pizza Mussarela',
      addons: [{ name: 'Borda Chocolate', priceCents: 500 }] },
  ] });
  assert.deepEqual(itemsBlock(buildOrderMessage(comboOrder([c]))), [
    '1x Combo Clássico — R$ 36,90',
    '   • Pizza Calabresa',
    '   + Borda Recheada com Catupiry — R$ 4,50',
    '   • Pizza Mussarela',
    '   + Borda Chocolate — R$ 5,00',
  ]);
});
