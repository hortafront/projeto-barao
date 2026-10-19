---
name: barao-testes
description: Use quando for escrever, rodar ou corrigir testes do cardápio Barão — arquivos em tests/unit, tests/integration, tests/helpers (fakeDb.js, clock.js, testkit.js), npm test / node --test — ou ao implementar qualquer service, rota ou regra (preço, meio a meio, addons, horário e turno que vira a meia-noite, override da loja, POST /api/orders, mensagem do WhatsApp, rotas /api/admin com 401/403), já que TDD é obrigatório; também antes de deploy, para o checklist manual no celular e Lighthouse.
---

# Barão — Estratégia de testes

Os exemplos de referência foram executados (89 testes verdes, com rotas mínimas de status/admin — inclusive `POST`/`PUT /api/admin/products` — e o `menu.routes.js` da skill `barao-api-express`) contra o código de referência das skills `barao-cardapio-precos`, `barao-pedido-whatsapp`, `barao-api-express` e `barao-supabase`.

**TDD obrigatório** para `shared/`, `src/services/` e `src/routes/`: escreva o teste, rode e **veja falhar pelo motivo
certo** (vermelho) → código mínimo para passar (verde) → refatore com tudo verde. Bug corrigido = teste que o reproduz antes.

Ferramentas: `node:test` + `node:assert/strict` + `supertest`. Nada de Jest/Vitest/mocha/sinon. `npm test` → `node --test`.

## Referências (copiar para o projeto)
| Referência | Destino |
|---|---|
| [reference/helpers/fakeDb.js](reference/helpers/fakeDb.js) | `tests/helpers/fakeDb.js` — repositório em memória + seed real |
| [reference/helpers/clock.js](reference/helpers/clock.js) | `tests/helpers/clock.js` — `fixedNow()` e instantes nomeados |
| [reference/helpers/testkit.js](reference/helpers/testkit.js) | `tests/helpers/testkit.js` — `makeApp()`, `validOrder()`, `ADMIN_EMAILS`, `normalizeSpaces()` |
| [reference/exemplos/unit/pricing.test.js](reference/exemplos/unit/pricing.test.js) | `tests/unit/pricing.test.js` |
| [reference/exemplos/unit/hours.service.test.js](reference/exemplos/unit/hours.service.test.js) | `tests/unit/hours.service.test.js` |
| [reference/exemplos/integration/orders.routes.test.js](reference/exemplos/integration/orders.routes.test.js) | `tests/integration/orders.routes.test.js` |
| [reference/exemplos/integration/whatsapp.message.test.js](reference/exemplos/integration/whatsapp.message.test.js) | `tests/integration/whatsapp.message.test.js` |
| [reference/exemplos/integration/admin.auth.test.js](reference/exemplos/integration/admin.auth.test.js) | `tests/integration/admin.auth.test.js` |
| [reference/exemplos/integration/admin.products.test.js](reference/exemplos/integration/admin.products.test.js) | `tests/integration/admin.products.test.js` |

## Estrutura
```
tests/
├── helpers/      fakeDb.js, clock.js, testkit.js   (sem testes aqui)
├── unit/         *.test.js — funções puras: shared/*, services/* (sem HTTP, sem db)
└── integration/  *.test.js — HTTP via supertest em createApp({ db: fakeDb, options }) (via makeApp)
```
`node --test` sem argumentos acha `**/*.test.js`. Para rodar um: `node --test tests/unit/pricing.test.js`;
filtrar por nome: `node --test --test-name-pattern="meio a meio"`.

## Regras obrigatórias
1. **Nunca tocar Supabase real** em teste nem importar `src/server.js`. Integração usa `makeApp()` → `createApp({ db: createFakeDb(...), options: { now, rateLimit: false, adminEmails, ... } })`. Nenhum `.env` necessário para `npm test`.
2. **`fakeDb` espelha a interface do `db`** da skill `barao-supabase` (tabela "Interface do repositório": mesmos nomes, argumentos e retornos camelCase, todos `async`, devolvendo cópias). Mudou um repo → muda o fake no mesmo commit. Métodos: `getMenu`, `getProductsByIds`, `getHours`, `updateHours`, `getSettings`, `updateSettings`, `createOrder`, `listOrders`, `getOrderById`, `updateOrderStatus`, `getOrdersSummary`, `listCategories`, `listProducts`, `getProductById`, `createProduct`, `updateProduct`, `deleteProduct`, `setProductAvailability`, `uploadProductImage`, `getUserByAccessToken`. O fake também **lança** se `subtotalCents` ≠ soma das linhas, `lineTotalCents` ≠ unitário × qtd ou `unitPriceCents` ≠ `baseUnitCents` + Σ `addons.priceCents` (como as constraints/`create_order` do banco). Snapshot dos itens igual ao `order_items`: `productIds`, `flavorNames`, `addons: [{ name, priceCents }]`, `baseUnitCents`, `unitPriceCents`, `lineTotalCents`. `deleteProduct(id)` lança `AppError('PRODUCT_HAS_ORDERS', 409)` se algum item salvo tem o id em `productIds`; senão `true`/`false` (não existe).
3. **Seed = cardápio real** do contrato (preços exatos em centavos) com ids fixos em `IDS` (`IDS.calabresa`, `IDS.bordaCatupiry`…). Teste que precisa de outro cenário passa `overrides` (`products`, `hours`, `settings`, `users`, `now`) — nunca edita o seed.
4. **Relógio injetável**: nada de `new Date()` solto em service/rota; rotas usam `options.now()` (padrão `() => new Date()`) e services recebem a data (`getStoreStatus(date, hours, override, tz)`, `createOrder(input, { db, now })`). Testes usam `fixedNow(iso)` — o mesmo relógio no app e no fake — com instantes UTC comentados com a hora de Fortaleza (UTC−3).
5. **Dinheiro**: asserções em centavos inteiros (`5949`), nunca em float. `formatBRL` já troca o NBSP do Intl por espaço; `normalizeSpaces` fica como defesa nos snapshots.
6. **Um comportamento por `it`**, nome em PT-BR descrevendo a regra ("meio a meio cobra o sabor mais caro").
7. **Testar pelo contrato público** sempre que possível (status HTTP, `error.code`, corpo da resposta), não por detalhes internos.
8. Cada teste cria seu próprio `makeApp()` (estado isolado; testes podem rodar em qualquer ordem).

## Casos obrigatórios (todos com exemplo completo nas referências)
- **Preço** (`shared/pricing.js` + `priceOrderItems` do `pricing.service.js`): inteira; meio a meio = sabor mais caro (ordem indiferente); addons somam por pizza; quantidade multiplica (pizza + addons); 0 ou 3+ sabores e preço não inteiro → erro; sabores repetidos, addon repetido e kind errado → `VALIDATION_ERROR`; esgotado → `PRODUCT_UNAVAILABLE` com `details`; subtotal do exemplo do contrato = 5949; **duas bordas na mesma pizza → `VALIDATION_ERROR` "Escolha apenas uma borda por pizza"** e borda + Catupiry por cima → aceito (unit e rota 400).
- **Mensagem do WhatsApp**: snapshot do texto exato para entrega + dinheiro com troco (exemplo do contrato), retirada + pix (sem endereço e sem linha de taxa), entrega + cartão sem referência, dinheiro sem troco; qtd 2 (linha da pizza = base × qtd, addon = preço × qtd); mensagem regenerada do pedido salvo = resposta; `whatsappUrl` = `https://wa.me/5585997687641?text=` + `encodeURIComponent(message)`.
- **Horários** (`hours.service.js`): dentro, fora (com `nextOpenAt`), limites exatos de abertura/fechamento, turno 18:00→00:30 aberto às 00:15 do dia seguinte, `is_closed`, override `open` e `closed`; **dias do seed**: segunda aberta, terça 19:00 fechada com `nextOpenAt` = quinta 18:00 (`-03:00`), pulando terça e quarta.
- **POST /api/orders**: 201 feliz (código `BR-0001`, subtotal, mensagem, pedido salvo); preço enviado pelo cliente ignorado; retirada sem endereço; 400 `VALIDATION_ERROR` (tabela de casos) sem salvar nada; 409 `STORE_CLOSED` (horário, terça de folga e override); 409 `PRODUCT_UNAVAILABLE` (sabor e addon esgotados); sem stack trace; 429 `RATE_LIMITED` no 11º pedido (único teste com `rateLimit: true`).
- **Admin**: 401 sem token / token inválido / sem `Bearer`; 403 e-mail fora de `adminEmails`; 403 com lista vazia (fail closed); 200 autorizado (case-insensitive, com espaços); rotas públicas seguem abertas; `GET /api/admin-config` pública → `{ supabaseUrl, supabaseAnonKey }`; `DELETE /api/admin/products/:id` → 204 (nunca pedido), 409 `PRODUCT_HAS_ORDERS` (id em `order_items.product_ids`), 404 (inexistente); formatos `{ products }`, `{ orders, page, pageSize, total }`, `{ order }`; `addonGroup` exposto em `GET /api/menu` e aceito no CRUD admin (grupo em pizza → 400).

## Esqueleto de um teste novo
```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, IDS } from '../helpers/testkit.js';

describe('GET /api/menu', () => {
  it('inclui produto esgotado com available=false (para exibir "Esgotado")', async () => {
    const { app, db } = makeApp();
    await db.setProductAvailability(IDS.bacon, false);
    const res = await request(app).get('/api/menu');
    assert.equal(res.status, 200);
    const bacon = res.body.categories.flatMap((c) => c.products).find((p) => p.id === IDS.bacon);
    assert.equal(bacon.available, false);
    assert.equal(bacon.priceCents, 3999);
  });
});
```

## Armadilhas
- **Rate limit** (10 req/10 min): `makeApp` passa `rateLimit: false`; sem isso a suíte passa de 10 POSTs e recebe 429. O limiter é criado dentro de `createApp` (store por instância), então o teste do 429 com `rateLimit: true` não contamina os outros.
- O schema Zod do pedido deve **descartar** campos desconhecidos (padrão do `z.object`), nunca `.strict()` — o teste "preço do cliente ignorado" espera 201.
- E-mails de admin entram por `options.adminEmails` (o `createApp` lê `ADMIN_EMAILS` do env só como padrão). Não mexa em `process.env` nos testes.
- Seed de horário: **terça e quarta fechadas** (`CLOSED_WEEKDAYS` no fakeDb); demais 18:00–23:30. Teste que precisa de loja aberta usa domingo/segunda/quinta–sábado (padrão do `makeApp`: domingo 20:00).
- 2026-10-18 é domingo. Conferir dia da semana de qualquer data nova com `new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza', weekday: 'long' })`.
- Snapshot de mensagem quebrou? Primeiro decida se o **formato** mudou de propósito (atualize a skill `barao-pedido-whatsapp` e o snapshot), senão o bug é no service.
- Não usar `t.mock.timers` para horário: a regra recebe `now` por injeção, mais simples e explícito.
- `supertest` não precisa de `listen()`: passe o `app` direto.

## Checklist manual antes do deploy (no celular real, 4G)
- [ ] `npm test` verde, sem testes `skip`/`only` esquecidos (`grep -rn "\.only\|\.skip\|todo:" tests`).
- [ ] Abrir o site pelo link real (HTTPS) em Android e iPhone; selo Aberto/Fechado correto para a hora atual de Fortaleza.
- [ ] Rolar categorias pelas abas; produto esgotado aparece como "Esgotado" e não adiciona.
- [ ] Montar meio a meio + addon + obs., bebida ×2; preço do modal = carrinho = subtotal da confirmação.
- [ ] Recarregar a página: carrinho continua; esgotar um item no admin e recarregar: item sai com aviso.
- [ ] Checkout entrega com troco e retirada com pix; erros de campo aparecem e focam o campo.
- [ ] Confirmação mostra o código; "Abrir WhatsApp" abre a conversa com `(85) 99768-7641` e o texto completo, acentos e emoji corretos.
- [ ] Pedido aparece no painel `/admin` (Pedidos) e no Resumo; confirmar e cancelar funcionam.
- [ ] Forçar loja fechada no admin → site mostra Fechado e a API recusa; voltar para Automático.
- [ ] Lighthouse mobile (DevTools ou PageSpeed Insights) ≥ 90 em Performance, Acessibilidade, Boas práticas e SEO.
- [ ] Navegação só por teclado (desktop) e leitor de tela básico (TalkBack/VoiceOver) no fluxo de compra.
