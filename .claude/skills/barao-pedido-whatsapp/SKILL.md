---
name: barao-pedido-whatsapp
description: Use quando for criar ou alterar src/services/order.service.js, src/services/whatsapp.service.js ou src/services/hours.service.js do Barão; quando montar/salvar o pedido do POST /api/orders, gerar o código BR-XXXX, montar a mensagem do WhatsApp (buildOrderMessage, buildWhatsAppUrl, wa.me, encodeURIComponent), formatar telefone (85) 99999-9999; quando o checkout do front (public/js/checkout.js) precisar abrir o WhatsApp; ou quando lidar com horário de funcionamento, loja aberta/fechada, STORE_CLOSED, GET /api/status, override manual, fuso America/Fortaleza ou turno que passa da meia-noite.
---

# Barão — Pedido, mensagem do WhatsApp e horário

Fluxo: cliente monta pedido → `POST /api/orders` → servidor valida, recalcula, salva → responde `{ code, subtotalCents, message, whatsappUrl }` (201) → front abre `whatsappUrl`. Não há pagamento online nem cálculo de frete.

Dependências: preços/snapshot em `barao-cardapio-precos` (`priceOrderItems`), schema Zod e `AppError` em `barao-api-express`, repositório em `barao-supabase`.

## Fluxo obrigatório do `order.service.js` (nessa ordem)
1. **Validar** — o body já chega validado por `validate(createOrderSchema)` na rota.
2. **Loja aberta?** — `getStoreStatus(now, hours, settings.storeOverride, timeZone)`; fechada → `409 STORE_CLOSED`.
3. **Carregar produtos** — `db.getProductsByIds(collectProductIds(items))`.
4. **Disponibilidade + kinds** e 5. **Recalcular** — `priceOrderItems(items, productsById)` (409 `PRODUCT_UNAVAILABLE` / 400).
6. **Subtotal + troco** — `calcOrderSubtotalCents(pricedItems)`; `assertChangeIsValid(payment, subtotalCents)`.
7. **Código + salvar** — `db.createOrder(draft)` chama a rpc `create_order(payload)`, que gera o código `BR-XXXX` (`next_order_code()`) e grava `orders` + `order_items` (snapshot) **na mesma transação**. Retorna `{ id, code, createdAt }`.
8. **Mensagem** — `buildOrderMessage({ ...draft, code, items: pricedItems })`.
9. **URL** — `buildWhatsAppUrl(settings.whatsappNumber, message)`.

```js
// src/services/order.service.js
import { AppError } from '../errors/AppError.js';
import { calcOrderSubtotalCents } from '../../shared/pricing.js';
import { getStoreStatus } from './hours.service.js';
import { collectProductIds, priceOrderItems, assertChangeIsValid } from './pricing.service.js';
import { buildOrderMessage, buildWhatsAppUrl } from './whatsapp.service.js';

export async function createOrder(input, { db, now = new Date(), timeZone = 'America/Fortaleza' }) {
  const [hours, settings] = await Promise.all([db.getHours(), db.getSettings()]);
  const status = getStoreStatus(now, hours, settings.storeOverride, timeZone);
  if (!status.open) {
    throw new AppError('STORE_CLOSED', 409, 'Estamos fechados agora. Confira nosso horário e volte já já!',
      status.nextOpenAt ? [{ nextOpenAt: status.nextOpenAt }] : undefined);
  }

  const products = await db.getProductsByIds(collectProductIds(input.items));
  const pricedItems = priceOrderItems(input.items, new Map(products.map((p) => [p.id, p])));
  const subtotalCents = calcOrderSubtotalCents(pricedItems);

  const isCash = input.payment.method === 'cash';
  const payment = { method: input.payment.method, changeForCents: isCash ? input.payment.changeForCents ?? null : null };
  assertChangeIsValid(payment, subtotalCents);

  const draft = {
    customer: input.customer,                          // { name, phone } — phone só dígitos
    fulfillment: input.fulfillment,
    address: input.fulfillment === 'delivery' ? input.address : null,
    payment,
    notes: input.notes?.trim() || null,
    subtotalCents,
    items: pricedItems,
  };
  const saved = await db.createOrder(draft);           // { id, code, createdAt }

  const message = buildOrderMessage({ ...draft, code: saved.code });
  const whatsappUrl = buildWhatsAppUrl(settings.whatsappNumber, message);
  return { code: saved.code, subtotalCents, message, whatsappUrl };
}
```
`now` é injetável (testes de horário). A rota passa `options.now()` e `options.timeZone` (ver `barao-api-express`).

## Mensagem — formato exato do contrato
```
🍕 *Pedido BR-0427 — Barão Delivery de Pizza*

*Itens*
1x Pizza meio a meio: Calabresa / Frango — R$ 34,99
   + Borda Recheada com Catupiry — R$ 4,50
   Obs.: sem cebola
2x Coca-Cola 1 Litro Zero Açúcar — R$ 20,00

*Subtotal:* R$ 59,49
_Taxa de entrega a combinar_

*Cliente:* João Silva — (85) 99999-9999
*Entrega:* Rua X, 123 — Bairro Y
Ref.: perto da praça
*Pagamento:* Dinheiro — troco para R$ 100,00
*Observações:* ...
```
Regras de linha (o exemplo do contrato manda): linha principal da pizza = `baseUnitCents × quantity` (sabor mais caro, **sem** addons); cada addon em linha própria `   + <nome> — R$ (priceCents × quantity)`. A soma das linhas exibidas de um item bate com `lineTotalCents` (= `unitPriceCents × quantity`), mas nenhuma linha mostra "unitário + addons". Bebida = `lineTotalCents` (= `baseUnitCents × quantity`). Separador é travessão `—` (U+2014) com espaços. Indentação de 3 espaços.
Variações: retirada → `*Retirada no balcão*` no lugar de `*Entrega:*`/`Ref.:` e **sem** a linha `_Taxa de entrega a combinar_`; `*Pagamento:* Pix`; `*Pagamento:* Cartão (maquininha)`; `*Pagamento:* Dinheiro` (sem troco); sem `Ref.:` se vazio; sem `*Observações:*` se vazio; sem `Obs.:` no item se vazio. Pizza inteira: `1x Pizza Calabresa — R$ 30,49`. Meio a meio: `1x Pizza meio a meio: Calabresa / Frango — R$ 34,99`.
Combo do dia (`kind: 'combo'`): linha principal `{qtd}x {nome do combo} — R$ (baseUnitCents × quantity)` (`baseUnitCents` = preço do combo); depois, **na ordem das vagas**, cada escolha em `   • {description}` (sem preço) e, logo abaixo da pizza, seus adicionais `   + {nome} — R$ (priceCents × quantity)` (assim a cozinha sabe em qual pizza vai a borda); `   Obs.: {notes}` por último, só se houver. Exemplo:
```
1x Combo Clássico — R$ 36,90
   • Pizza meio a meio: Calabresa / Mussarela
   + Borda Recheada com Catupiry — R$ 4,50
   • Coca-Cola 1 Litro
   Obs.: sem cebola
```
A soma dos valores do bloco = `lineTotalCents`. Os dados vêm de `item.choices` (`[{ label, kind, description, addons }]`), que no banco é `order_items.combo_choices`; o pedido regenerado do banco usa `combo_choices`.
Os campos usados (`description`, `quantity`, `baseUnitCents`, `addons[{ name, priceCents }]`, `lineTotalCents`, `notes`) estão no snapshot de `order_items` (`base_unit_cents`, `addons` jsonb), então a mensagem pode ser **regenerada a partir do banco** (`db.getOrderById(id)` → `buildOrderMessage(order)`).

Implementação de referência completa (com `formatPhoneBR`, `buildOrderMessage`, `buildWhatsAppUrl`) e testes de exemplo: [reference/whatsapp.service.md](reference/whatsapp.service.md).

## Telefone
- Schema guarda **só dígitos**, 10–11 (DDD + número): `85999999999`.
- `formatPhoneBR('85999999999')` → `(85) 99999-9999`; `formatPhoneBR('8532221111')` → `(85) 3222-1111`. Outro tamanho → devolve como veio.
- Número da loja vem de `settings.whatsapp_number` (`5585997687641`, só dígitos, com 55).

## URL do WhatsApp
- `https://wa.me/<número>?text=<encodeURIComponent(mensagem)>`. **Não** usar `URLSearchParams` (vira `+` nos espaços) nem `encodeURI`.
- Emoji e acentos viram UTF-8 percent-encoded (🍕 = `%F0%9F%8D%95`); quebras de linha `%0A`.
- Limite prático: manter a URL < ~4000 caracteres (alguns navegadores Android/in-app falham acima disso). Com limites do schema (30 itens, obs. do item ≤ 140, obs. do pedido ≤ 280) um pedido normal fica bem abaixo; se passar de 4000, logar `warn` (sem dados pessoais) — o pedido já está salvo e o front ainda mostra o código.
- Texto livre (nome, endereço, obs.) passa por `oneLine()` (colapsa `\s+` em espaço) para não quebrar o layout.

## Como o front abre o link (`public/js/checkout.js`)
```js
const res = await api.createOrder(payload);          // POST /api/orders
cart.clear();                                         // pedido salvo: limpar carrinho (barao:cart:v1)
showOrderDone(res.code, res.whatsappUrl);             // tela "Pedido BR-0427 criado" + botão/link "Abrir WhatsApp"
window.location.href = res.whatsappUrl;               // mesma aba: funciona no mobile e não é bloqueado
```
- **Não** usar `window.open` depois do `await` — vira popup bloqueado (perdeu o gesto do usuário).
- Sempre renderizar fallback: `<a href={whatsappUrl} rel="noopener">Abrir WhatsApp</a>` (criado com `dom.js`, nunca `innerHTML`) + código do pedido, para quem voltar à aba.
- Erros: `409 STORE_CLOSED` → aviso de loja fechada (mostrar `nextOpenAt` se veio); `409 PRODUCT_UNAVAILABLE` → marcar itens esgotados e recarregar `/api/menu`; `429` → "Muitas tentativas, aguarde alguns minutos"; desabilitar o botão enquanto envia (evita pedido duplicado).

## Horário (`hours.service.js`)
API pública: `getLocalParts(date, timeZone)`, `toMinutes('18:00')`, `isOpenAt(date, hours, override = 'auto', timeZone = 'America/Fortaleza')` → `boolean`, `getStoreStatus(date, hours, override, timeZone)` → `{ open, reason: 'hours'|'override_open'|'override_closed', nextOpenAt: string|null, todayHours }`.
Regras: `override` `'open'`/`'closed'` vence tudo; `'auto'` usa `business_hours`. Se `closesAt <= opensAt` o turno vira a meia-noite: 18:00→00:30 de sábado vale de sábado 18:00 até domingo 00:30 — por isso **sempre olhar o turno de ontem** também. Intervalo é `[abre, fecha)`. Horas vêm do Postgres como `'18:00:00'` — `toMinutes` aceita `HH:MM` e `HH:MM:SS`.
Implementação de referência + casos de teste: [reference/hours.service.md](reference/hours.service.md).

## Armadilhas
- Usar `date.getDay()`/`getHours()` (fuso do servidor, geralmente UTC!) em vez de `Intl` com `timeZone` → loja "fecha" às 21h de Fortaleza.
- Esquecer o turno de ontem → pedidos à 00:10 rejeitados indevidamente.
- Montar a mensagem a partir do body do cliente (preços/nomes) em vez de `pricedItems` do banco.
- Gerar código no Node (`count(*)+1`) → códigos duplicados sob concorrência. Só a sequence.
- Salvar `orders` e depois `order_items` em duas chamadas → pedido sem itens se a segunda falhar. Só a rpc `create_order`.
- Logar a mensagem/telefone/endereço. Logar só `code`, `subtotalCents`, nº de itens.
- `NBSP` do `Intl` em `R$ 34,99`: `formatBRL` já normaliza.

## Checklist final
- [ ] Ordem do fluxo respeitada; loja fechada checada antes de tocar produtos.
- [ ] Mensagem bate caractere a caractere com o contrato (teste com o pedido exemplo → `R$ 59,49`).
- [ ] Variações cobertas por teste: retirada, pix, cartão, dinheiro com/sem troco, sem obs., sem ref., pizza inteira.
- [ ] `buildWhatsAppUrl` usa `encodeURIComponent` e número só com dígitos.
- [ ] `isOpenAt` testado com 23:59, 00:10, 00:30 (fechado), override open/closed e dia `isClosed`.
- [ ] Front abre com `window.location.href` + link de fallback; carrinho limpo após 201.
