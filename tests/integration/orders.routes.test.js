// tests/integration/orders.routes.test.js — POST /api/orders via createApp({ db: fakeDb, options: { now } }) (makeApp).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, validOrder, IDS } from '../helpers/testkit.js';

const post = (app, body) => request(app).post('/api/orders').send(body);

describe('POST /api/orders — caminho feliz', () => {
  it('201 com código, subtotal recalculado, mensagem e link do WhatsApp; salva o pedido', async () => {
    const { app, db } = makeApp();
    const res = await post(app, validOrder());

    assert.equal(res.status, 201);
    assert.equal(res.body.code, 'BR-0001');
    assert.equal(res.body.subtotalCents, 5949); // 3499 (mais caro) + 450 + 2 × 1000
    assert.equal(res.body.whatsappUrl, `https://wa.me/5585997687641?text=${encodeURIComponent(res.body.message)}`);

    assert.equal(db.state.orders.length, 1);
    const saved = db.state.orders[0];
    assert.equal(saved.subtotalCents, 5949);
    assert.equal(saved.status, 'received');
    // snapshot completo em order_items: ids, base, addons com preço
    const [pizza, drink] = saved.items;
    assert.deepEqual(pizza.productIds, [IDS.calabresa, IDS.frango, IDS.bordaCatupiry]);
    assert.equal(pizza.baseUnitCents, 3499);
    assert.deepEqual(pizza.addons, [{ name: 'Borda Recheada com Catupiry', priceCents: 450 }]);
    assert.equal(pizza.unitPriceCents, 3949);
    assert.deepEqual(drink.productIds, [IDS.coca1lZero]);
    assert.deepEqual(drink.addons, []);
    assert.equal(drink.baseUnitCents, 1000);
  });

  it('IGNORA preços enviados pelo cliente e recalcula do banco', async () => {
    const { app } = makeApp();
    const body = validOrder();
    body.items[0].priceCents = 1;
    body.items[0].unitPriceCents = 1;
    body.items[1].priceCents = 1;
    body.subtotalCents = 1;

    const res = await post(app, body);
    assert.equal(res.status, 201); // campos extras são descartados (schema sem .strict() nesses pontos)
    assert.equal(res.body.subtotalCents, 5949);
  });

  it('retirada não exige endereço', async () => {
    const { app, db } = makeApp();
    const { address, ...body } = validOrder({ fulfillment: 'pickup' });
    const res = await post(app, body);
    assert.equal(res.status, 201);
    assert.equal(db.state.orders[0].fulfillment, 'pickup');
  });
});

describe('POST /api/orders — 400 VALIDATION_ERROR', () => {
  const cases = [
    ['entrega sem endereço', () => { const { address, ...b } = validOrder(); return b; }],
    ['nome com 1 letra', () => validOrder({ customer: { name: 'J', phone: '85999999999' } })],
    ['telefone com 9 dígitos', () => validOrder({ customer: { name: 'João', phone: '859999999' } })],
    ['sem itens', () => validOrder({ items: [] })],
    ['quantidade 21', () => validOrder({ items: [{ kind: 'drink', productId: IDS.coca600, quantity: 21 }] })],
    ['sabores repetidos', () => validOrder({ items: [{ kind: 'pizza', flavorIds: [IDS.frango, IDS.frango], addonIds: [], quantity: 1 }] })],
    ['3 sabores', () => validOrder({ items: [{ kind: 'pizza', flavorIds: [IDS.frango, IDS.bacon, IDS.mista], addonIds: [], quantity: 1 }] })],
    ['bebida como sabor', () => validOrder({ items: [{ kind: 'pizza', flavorIds: [IDS.coca600], addonIds: [], quantity: 1 }] })],
    ['pizza como addon', () => validOrder({ items: [{ kind: 'pizza', flavorIds: [IDS.frango], addonIds: [IDS.bacon], quantity: 1 }] })],
    ['duas bordas na mesma pizza', () => validOrder({ items: [{ kind: 'pizza', flavorIds: [IDS.frango], addonIds: [IDS.bordaCatupiry, IDS.bordaChocolate], quantity: 1 }] })],
    ['troco menor que o total', () => validOrder({ payment: { method: 'cash', changeForCents: 5000 } })],
    ['método de pagamento inválido', () => validOrder({ payment: { method: 'boleto' } })],
    ['observação > 280', () => validOrder({ notes: 'x'.repeat(281) })],
  ];

  for (const [name, build] of cases) {
    it(name, async () => {
      const { app, db } = makeApp();
      const res = await post(app, build());
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      assert.equal(typeof res.body.error.message, 'string');
      assert.equal(db.state.orders.length, 0, 'não pode salvar pedido inválido');
    });
  }

  it('duas bordas → mensagem amigável "Escolha apenas uma borda por pizza"', async () => {
    const { app } = makeApp();
    const res = await post(app, validOrder({
      items: [{ kind: 'pizza', flavorIds: [IDS.calabresa], addonIds: [IDS.bordaCatupiry, IDS.bordaChocolate], quantity: 1 }],
    }));
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.match(res.body.error.message, /Escolha apenas uma borda por pizza/);
    assert.equal(res.body.error.details[0].path, 'items.0.addonIds');
  });

  it('borda + Catupiry por cima → 201 (Catupiry por cima combina com qualquer borda)', async () => {
    const { app } = makeApp();
    const res = await post(app, validOrder({
      items: [{ kind: 'pizza', flavorIds: [IDS.frango], addonIds: [IDS.bordaChocolate, IDS.catupiryCima], quantity: 1 }],
    }));
    assert.equal(res.status, 201);
    assert.equal(res.body.subtotalCents, 3499 + 999 + 450);
  });

  it('não vaza stack trace', async () => {
    const { app } = makeApp();
    const res = await post(app, { lixo: true });
    assert.equal(res.status, 400);
    assert.doesNotMatch(JSON.stringify(res.body), /at .*\.js:\d+/);
  });
});

describe('POST /api/orders — 409', () => {
  it('STORE_CLOSED fora do horário', async () => {
    const { app, db } = makeApp({ now: '2026-10-18T18:00:00Z' }); // domingo 15:00
    const res = await post(app, validOrder());
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'STORE_CLOSED');
    assert.equal(db.state.orders.length, 0);
  });

  it('STORE_CLOSED na terça (folga) com nextOpenAt = quinta 18:00', async () => {
    const { app } = makeApp({ now: '2026-10-20T22:00:00Z' }); // terça 19:00
    const res = await post(app, validOrder());
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'STORE_CLOSED');
    assert.equal(new Date(res.body.error.details[0].nextOpenAt).toISOString(), '2026-10-22T21:00:00.000Z'); // qui 18:00 -03:00
  });

  it('STORE_CLOSED com override "closed" mesmo dentro do horário', async () => {
    const { app } = makeApp({ settings: { storeOverride: 'closed' } });
    const res = await post(app, validOrder());
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'STORE_CLOSED');
  });

  it('override "open" aceita pedido fora do horário', async () => {
    const { app } = makeApp({ now: '2026-10-18T18:00:00Z', settings: { storeOverride: 'open' } });
    const res = await post(app, validOrder());
    assert.equal(res.status, 201);
  });

  it('PRODUCT_UNAVAILABLE quando um sabor está esgotado', async () => {
    const { app, db } = makeApp();
    await db.setProductAvailability(IDS.frango, false);
    const res = await post(app, validOrder());
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'PRODUCT_UNAVAILABLE');
    assert.equal(db.state.orders.length, 0);
  });

  it('PRODUCT_UNAVAILABLE quando o addon está esgotado', async () => {
    const { app, db } = makeApp();
    await db.setProductAvailability(IDS.bordaCatupiry, false);
    const res = await post(app, validOrder());
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'PRODUCT_UNAVAILABLE');
  });
});

describe('POST /api/orders — códigos sequenciais', () => {
  it('BR-0001, BR-0002…', async () => {
    const { app } = makeApp();
    assert.equal((await post(app, validOrder())).body.code, 'BR-0001');
    assert.equal((await post(app, validOrder())).body.code, 'BR-0002');
  });
});

describe('POST /api/orders — rate limit', () => {
  it('11º pedido em 10 min do mesmo IP → 429 RATE_LIMITED', async () => {
    const { app } = makeApp({ options: { rateLimit: true } }); // só aqui o limiter fica ligado
    for (let i = 0; i < 10; i += 1) assert.equal((await post(app, validOrder())).status, 201);
    const res = await post(app, validOrder());
    assert.equal(res.status, 429);
    assert.equal(res.body.error.code, 'RATE_LIMITED');
  });
});

describe('POST /api/orders — pagamento salvo e número da loja', () => {
  it('dinheiro com troco: salva payment e addons do snapshot', async () => {
    const { app, db } = makeApp();
    const res = await post(app, validOrder());
    assert.equal(res.status, 201);
    assert.equal(res.body.whatsappUrl, 'https://wa.me/5585997687641?text=' + encodeURIComponent(res.body.message));
    assert.deepEqual(db.state.orders[0].payment, { method: 'cash', changeForCents: 10000 });
    assert.deepEqual(db.state.orders[0].items[0].addons, [{ name: 'Borda Recheada com Catupiry', priceCents: 450 }]);
  });

  it('pix com changeForCents → 201 e salva null', async () => {
    const { app, db } = makeApp();
    const res = await post(app, validOrder({ payment: { method: 'pix', changeForCents: 10000 } }));
    assert.equal(res.status, 201);
    assert.equal(db.state.orders[0].payment.changeForCents, null);
  });

  it('número da loja é lido a cada pedido', async () => {
    const { app, db } = makeApp();
    assert.match((await post(app, validOrder())).body.whatsappUrl, /^https:\/\/wa\.me\/5585997687641\?text=/);
    await db.updateSettings({ whatsappNumber: '5585988887777' });
    const res = await post(app, validOrder());
    assert.ok(res.body.whatsappUrl.startsWith('https://wa.me/5585988887777?text='));
  });
});

describe('POST /api/orders — mensagens de loja fechada e erros', () => {
  it('STORE_CLOSED na terça: mensagem com próxima abertura e details', async () => {
    const { app, db } = makeApp({ now: '2026-10-20T22:00:00Z' });
    const res = await post(app, validOrder());
    assert.equal(res.status, 409);
    assert.equal(res.body.error.message, 'Estamos fechados agora. Abrimos quinta às 18:00.');
    assert.deepEqual(res.body.error.details, [{ nextOpenAt: '2026-10-22T21:00:00.000Z' }]);
    assert.equal(db.state.orders.length, 0);
  });

  it('override closed: mensagem genérica, sem details', async () => {
    const { app, db } = makeApp({ settings: { storeOverride: 'closed' } });
    const res = await post(app, validOrder());
    assert.equal(res.status, 409);
    assert.equal(res.body.error.message, 'Estamos fechados no momento.');
    assert.equal(res.body.error.details, undefined);
    assert.equal(db.state.orders.length, 0);
  });

  it('produto inexistente → 409 PRODUCT_UNAVAILABLE com name null', async () => {
    const { app, db } = makeApp();
    const res = await post(app, validOrder({
      items: [{ kind: 'drink', productId: '00000000-0000-4000-8000-00000000ffff', quantity: 1 }],
    }));
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'PRODUCT_UNAVAILABLE');
    assert.equal(res.body.error.details[0].name, null);
    assert.equal(db.state.orders.length, 0);
  });

  it('falha do banco → 500 INTERNAL sem stack', async (t) => {
    t.mock.method(console, 'error', () => {});
    const { app, db } = makeApp();
    db.getHours = async () => { throw new Error('boom'); };
    const res = await post(app, validOrder());
    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL');
    assert.ok(!('stack' in res.body.error));
    assert.ok(!JSON.stringify(res.body).includes(' at '));
  });
});

describe('POST /api/orders — logs e texto hostil', () => {
  it('log sem PII', async (t) => {
    const log = t.mock.method(console, 'log', () => {});
    const { app } = makeApp();
    const res = await post(app, validOrder());
    assert.equal(res.status, 201);
    const all = log.mock.calls.map((c) => c.arguments.join(' '));
    for (const pii of ['João', '85999999999', 'Rua X']) assert.ok(all.every((l) => !l.includes(pii)), pii);
    assert.ok(all.some((l) => l.includes('"code":"BR-0001"')));
  });

  it('texto livre hostil não quebra a mensagem nem a URL', async (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'log', () => {});
    const { app } = makeApp();
    const items = Array.from({ length: 30 }, () => ({
      kind: 'pizza', flavorIds: [IDS.calabresa], addonIds: [], quantity: 1, notes: 'ç'.repeat(140),
    }));
    items[0].notes = 'sem\tcebola\n\n';
    const res = await post(app, validOrder({
      customer: { name: 'João\n🍕\uD83C', phone: '85999999999' },
      address: { street: 'Rua X', number: '123', district: 'Bairro Y', reference: 'r'.repeat(120) },
      notes: 'n'.repeat(280),
      payment: { method: 'pix' },
      items,
    }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(res.body.message.includes('*Cliente:* João 🍕� — (85) 99999-9999'));
    assert.ok(res.body.message.includes('   Obs.: sem cebola\n'));
    assert.equal(decodeURIComponent(res.body.whatsappUrl.split('?text=')[1]), res.body.message);
    assert.equal(warn.mock.callCount(), 1);
    const w = String(warn.mock.calls[0].arguments[0]);
    assert.equal(JSON.parse(w).msg, 'whatsapp_url_long');
    assert.ok(!w.includes('João') && !w.includes('85999999999'));
  });
});
