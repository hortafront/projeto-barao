// tests/integration/whatsapp.message.test.js — snapshot do TEXTO EXATO devolvido em POST /api/orders.
// Testa pelo contrato público (res.body.message), não pela forma interna do whatsapp.service.js.
// O formato vem do contrato / skill barao-pedido-whatsapp. Se aquela skill fixar outro detalhe,
// atualize o snapshot AQUI PRIMEIRO (vermelho) e só depois o service (verde).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, validOrder, normalizeSpaces, IDS } from '../helpers/testkit.js';
import { buildOrderMessage } from '../../src/services/whatsapp.service.js';

async function messageFor(body) {
  const { app } = makeApp();
  const res = await request(app).post('/api/orders').send(body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  // a URL deve carregar exatamente a mensagem, codificada com encodeURIComponent
  assert.equal(res.body.whatsappUrl, `https://wa.me/5585997687641?text=${encodeURIComponent(res.body.message)}`);
  return normalizeSpaces(res.body.message);
}

const lines = (...l) => l.join('\n');

describe('mensagem do WhatsApp', () => {
  it('entrega + dinheiro com troco (exemplo do contrato)', async () => {
    const msg = await messageFor(validOrder());
    assert.equal(msg, lines(
      '🍕 *Pedido BR-0001 — Barão Delivery de Pizza*',
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
      '*Observações:* Interfone quebrado',
    ));
  });

  it('retirada + pix: sem endereço, sem taxa, sem observações', async () => {
    const { address, notes, ...base } = validOrder();
    const msg = await messageFor({
      ...base,
      customer: { name: 'Maria Souza', phone: '85988887777' },
      fulfillment: 'pickup',
      payment: { method: 'pix' },
      items: [{ kind: 'pizza', flavorIds: [IDS.marguerita], addonIds: [], quantity: 1 }],
    });
    assert.equal(msg, lines(
      '🍕 *Pedido BR-0001 — Barão Delivery de Pizza*',
      '',
      '*Itens*',
      '1x Pizza Marguerita — R$ 34,90',
      '',
      '*Subtotal:* R$ 34,90',
      '',
      '*Cliente:* Maria Souza — (85) 98888-7777',
      '*Retirada no balcão*',
      '*Pagamento:* Pix',
    ));
  });

  it('entrega + cartão, sem referência: omite a linha "Ref."', async () => {
    const { notes, ...base } = validOrder();
    const msg = await messageFor({
      ...base,
      address: { street: 'Av. Beira Mar', number: '500', district: 'Meireles', reference: '' },
      payment: { method: 'card' },
      items: [{ kind: 'drink', productId: IDS.guarana1l, quantity: 1 }],
    });
    assert.equal(msg, lines(
      '🍕 *Pedido BR-0001 — Barão Delivery de Pizza*',
      '',
      '*Itens*',
      '1x Guaraná 1 Litro — R$ 8,00',
      '',
      '*Subtotal:* R$ 8,00',
      '_Taxa de entrega a combinar_',
      '',
      '*Cliente:* João Silva — (85) 99999-9999',
      '*Entrega:* Av. Beira Mar, 500 — Meireles',
      '*Pagamento:* Cartão (maquininha)',
    ));
  });

  it('dinheiro sem troco: só "Dinheiro"', async () => {
    const msg = await messageFor(validOrder({ payment: { method: 'cash' } }));
    assert.match(msg, /^\*Pagamento:\* Dinheiro$/m);
  });

  it('quantidade multiplica a linha da pizza (base) e cada addon na própria linha', async () => {
    const msg = await messageFor(validOrder({
      items: [{ kind: 'pizza', flavorIds: [IDS.frango], addonIds: [IDS.bordaCatupiry], quantity: 2 }],
      payment: { method: 'pix' },
    }));
    assert.match(msg, /^2x Pizza Frango — R\$ 69,98$/m);                      // 3499 × 2
    assert.match(msg, /^   \+ Borda Recheada com Catupiry — R\$ 9,00$/m);    // 450 × 2
    assert.match(msg, /^\*Subtotal:\* R\$ 78,98$/m);                          // (3499 + 450) × 2
  });

  it('mensagem regenerada a partir do pedido salvo é idêntica à resposta', async () => {
    const { app, db } = makeApp();
    const res = await request(app).post('/api/orders').send(validOrder());
    assert.equal(res.status, 201);
    const saved = await db.getOrderById(db.state.orders[0].id); // Order (snapshot de order_items)
    assert.equal(buildOrderMessage(saved), res.body.message);
  });

  it('nome do cliente com caracteres especiais vai como texto e a URL continua válida', async () => {
    const msg = await messageFor(validOrder({ customer: { name: 'Zé & Ana #1 *VIP*', phone: '8532221111' } }));
    assert.match(msg, /^\*Cliente:\* Zé & Ana #1 \*VIP\* — \(85\) 3222-1111$/m);
  });
});
