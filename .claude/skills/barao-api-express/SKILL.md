---
name: barao-api-express
description: Use quando for criar ou alterar o servidor Express do Barão — src/app.js (createApp({ db, options })), src/server.js, src/routes/**/*.routes.js, src/middleware/* (validate, errorHandler, requireAdmin, rateLimit, upload), src/schemas/*.schema.js (Zod: order.schema, product.schema, hours.schema), src/errors/AppError.js; quando adicionar uma rota /api/..., tratar erros/status HTTP (VALIDATION_ERROR, STORE_CLOSED, 401/403/404/409/429), configurar helmet/CSP, CORS, rate-limit, upload de imagem com multer, autenticação do painel /api/admin (Bearer, ADMIN_EMAILS) ou logging.
---

# Barão — API Express

Camadas: **rota fina** (HTTP ↔ service) → **service** (regra de negócio, puro quando possível) → **repository** (único que fala com Supabase, injetado como `db`). Zod no servidor é a autoridade de validação.

## Regras obrigatórias
1. `createApp({ db, options })` em `src/app.js` **não** cria client Supabase nem chama `listen` — isso é do `src/server.js`. `options = { now, rateLimit, adminEmails, corsOrigin, supabaseUrl, supabaseAnonKey, timeZone, isProduction, trustProxy }` (default de cada um vem do env: `ADMIN_EMAILS`, `CORS_ORIGIN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `STORE_TIMEZONE`, `NODE_ENV`, `TRUST_PROXY`). Testes usam `createApp({ db: fakeRepo, options: { rateLimit: false, now: () => fixedDate } })`.
2. Ordem dos middlewares: `helmet` (CSP) → `cors` (só `CORS_ORIGIN`) → `express.json({ limit: '20kb' })` → logger → `express.static('public')` + `/shared` → rotas → 404 → `errorHandler` (último).
3. Toda rota `async` embrulhada em `asyncHandler` (Express 4 não captura promise rejeitada).
4. Toda entrada (`body`, `query`, `params` com `:id`) passa por `validate(schema, source)`.
5. Erros só via `throw new AppError(code, status, message, details?)`; resposta **sempre** `{ error: { code, message, details? } }`, mensagem em PT-BR amigável, **nunca** stack/SQL.
6. Dinheiro sai como `priceCents`/`subtotalCents` inteiros; o servidor ignora qualquer preço vindo do cliente.
7. Nada de dados pessoais em log (nome, telefone, endereço, mensagem, header Authorization).

## Rotas (contrato)
| Método e caminho | Middleware extra | Service / repo | Sucesso |
|---|---|---|---|
| `GET /api/menu` | — | `db.getMenu()` → mapeia para `{ categories: [{ slug, name, products: [{ id, kind, name, description, priceCents, imageUrl, available, addonGroup }] }] }` (`addonGroup`: `'borda'` \| `null`; ver `reference/app.md` → `menu.routes.js`) | 200 |
| `GET /api/status` | — | `getStoreStatus(now, hours, override, tz)` | 200 `{ open, reason, nextOpenAt, todayHours }` |
| `POST /api/orders` | `ordersRateLimit` (10/10 min por IP), `validate(createOrderSchema)` | `createOrder(body, { db, now, timeZone })` | **201** `{ code, subtotalCents, message, whatsappUrl }` |
| `GET /api/admin-config` | **nenhum** (pública, fora do `requireAdmin`), `Cache-Control: public, max-age=300` | lê `options.supabaseUrl`/`options.supabaseAnonKey` | 200 `{ supabaseUrl, supabaseAnonKey }` |
| `GET /api/admin/products` | `requireAdmin` (em todo `/api/admin`) | `db.listProducts()` | 200 `{ products: [...] }` |
| `POST /api/admin/products` | `validate(productCreateSchema)` (inclui `addonGroup: 'borda' \| null`, só em addon) | `db.createProduct` | 201 |
| `PUT /api/admin/products/:id` | `validate(idParamSchema,'params')`, `validate(productUpdateSchema)` | `db.updateProduct` | 200 / 404 |
| `DELETE /api/admin/products/:id` | params | `db.deleteProduct(id)` — lança 409 `PRODUCT_HAS_ORDERS` se existir `order_items` com `product_ids @> array[id]`; `false` → 404 | 204 / 404 / 409 |
| `PATCH /api/admin/products/:id/availability` | `validate(availabilitySchema)` | `db.setProductAvailability` | 200 |
| `POST /api/admin/products/:id/image` | `imageUpload` (multer, campo `image`, jpeg/png/webp, 2 MB) | `db.uploadProductImage` | 200 |
| `GET /api/admin/hours` / `PUT /api/admin/hours` | `validate(hoursSchema)` (array de 7 dias) | `db.getHours` / `db.updateHours` | 200 |
| `GET /api/admin/settings` / `PUT /api/admin/settings` | `validate(settingsSchema)` `{ storeOverride }` | `db.getSettings` / `db.updateSettings` | 200 |
| `GET /api/admin/orders?from&to&page` | `validate(ordersQuerySchema,'query')` | `db.listOrders` | 200 `{ orders: [...], page, pageSize, total }` |
| `GET /api/admin/orders/:id` | params | `db.getOrderById` | 200 `{ order }` (com `items`) / 404 |
| `PATCH /api/admin/orders/:id/status` | `validate(orderStatusSchema)` | `db.updateOrderStatus` | 200 / 404 |
| `GET /api/admin/reports/summary?from&to` | query | `db.getOrdersSummary` | 200 `{ ordersCount, grossCents, topItems: [{ name, quantity }] }` |

Detalhes de UI/fluxo do painel: skill `barao-painel-admin`. Interface do `db`: skill `barao-supabase`.

## Código de erro → HTTP
| code | status | Quando |
|---|---|---|
| `VALIDATION_ERROR` | 400 (413 se payload/arquivo grande) | Zod, JSON inválido, sabor de kind errado, duas bordas na mesma pizza ("Escolha apenas uma borda por pizza."), `addonGroup` em produto que não é addon, troco < total, imagem inválida |
| `UNAUTHORIZED` | 401 | Sem Bearer, token inválido/expirado |
| `FORBIDDEN` | 403 | Logado, mas e-mail fora de `ADMIN_EMAILS` |
| `NOT_FOUND` | 404 | Rota `/api` inexistente; id não encontrado |
| `STORE_CLOSED` | 409 | Pedido fora do horário / override `closed` |
| `PRODUCT_UNAVAILABLE` | 409 | Produto inexistente ou `available = false` (`details` lista `{ productId, name }`) |
| `PRODUCT_HAS_ORDERS` | 409 | `DELETE` de produto que já aparece em algum pedido (`order_items.product_ids`) — "Produto já tem pedidos; marque como esgotado em vez de excluir" |
| `RATE_LIMITED` | 429 | Limite de `POST /api/orders` ou do admin |
| `INTERNAL` | 500 | Qualquer outra coisa (detalhe só no log) |

## Rota fina — exemplo
```js
// src/routes/orders.routes.js
import express from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { ordersRateLimit } from '../middleware/rateLimit.js';
import { createOrderSchema } from '../schemas/order.schema.js';
import { createOrder } from '../services/order.service.js';

export function ordersRoutes({ db, options }) {
  const router = express.Router();
  router.post('/',
    ordersRateLimit({ enabled: options.rateLimit }),
    validate(createOrderSchema),
    asyncHandler(async (req, res) => {
      const result = await createOrder(req.body, { db, now: options.now(), timeZone: options.timeZone });
      console.log(JSON.stringify({ level: 'info', msg: 'order_created', code: result.code,
        subtotalCents: result.subtotalCents, items: req.body.items.length }));
      res.status(201).json(result);
    }));
  return router;
}
```
Padrão de nomes: cada arquivo exporta uma factory `xxxRoutes({ db, options })` — `menuRoutes`, `statusRoutes`, `ordersRoutes`, `adminRoutes` (em `routes/admin/index.js`, montando `products.routes.js`, `hours.routes.js`, `settings.routes.js`, `orders.routes.js`, `reports.routes.js`). Respostas de leitura pública: `GET /api/menu` com `Cache-Control: public, max-age=30`; `GET /api/status` com `no-store`.

## Schema do pedido (resumo)
`createOrderSchema = z.discriminatedUnion('fulfillment', [delivery, pickup])` — `address` obrigatório (`street` 2–120, `number` 1–20, `district` 2–60, `reference` ≤ 120 opcional) só em `delivery`; em `pickup` é descartado (`null`). Itens: `z.discriminatedUnion('kind', [pizza, drink])`; pizza `flavorIds` 1–2 uuids distintos, `addonIds` distintos (default `[]`; "uma borda por pizza" depende do `addonGroup` do banco → checado no `pricing.service`, não no Zod), `notes` ≤ 140; drink `productId`; `quantity` int 1–20; 1–30 itens. `customer.name` 2–60; `customer.phone` → só dígitos, 10–11. `payment.method` `pix|cash|card`, `changeForCents` int opcional. `notes` ≤ 280.
Código completo (order, product, hours/settings, query de datas, `idParamSchema`): [reference/schemas.md](reference/schemas.md). Dependência fixada: `"zod": "^3.23.8"` no `package.json` (zod 4 muda `.default()` em `.partial()` e mensagens).

## Middlewares e app completos
`AppError`, `asyncHandler`, `validate`, `errorHandler`, `requireAdmin`, `ordersRateLimit`/`adminRateLimit`, `imageUpload` + `sniffImageType`, `requestLogger`, `createApp` e `server.js`: [reference/app.md](reference/app.md).

Pontos-chave:
- **requireAdmin**: `Authorization: Bearer <token>` → `db.getUserByAccessToken(token)` (repo chama `supabase.auth.getUser(token)`) → e-mail (case-insensitive) em `ADMIN_EMAILS` (produção: `ADMIN_EMAILS=guslolhorta@gmail.com`). Sem header/token inválido → 401; e-mail fora → 403. Lista vazia = ninguém entra.
- **CSP** (helmet): `default-src 'self'`; scripts `'self'` + `https://cdn.jsdelivr.net` (supabase-js ESM do admin); estilos `fonts.googleapis.com`; fontes `fonts.gstatic.com`; `img-src`/`connect-src` incluem a origem de `SUPABASE_URL` (login do admin). O browser do admin obtém URL + ANON key de `GET /api/admin-config`. Proibido `<script>` inline e `onclick=` no HTML.
- **Rate-limit**: `express-rate-limit` v7 (`limit`, não `max`); `handler` repassa `AppError('RATE_LIMITED', 429, ...)` para manter o formato único. Atrás de proxy, `options.trustProxy = 1` (env opcional `TRUST_PROXY=1`), senão todos os clientes compartilham o IP do proxy (ou, configurado errado, qualquer um forja `X-Forwarded-For`).
- **Upload**: `multer.memoryStorage()`, `fileSize` 2 MB, 1 arquivo, campo `image`; conferir bytes mágicos (o `mimetype` vem do cliente); erro de tamanho → 413.

## Armadilhas
- Handler `async` sem `asyncHandler` → requisição pendurada.
- `:id` sem validar uuid → Postgres `22P02` vira 500 em vez de 404/400.
- `errorHandler` registrado antes das rotas ou com 3 argumentos → nunca é chamado.
- Importar `server.js` nos testes → tenta conectar no Supabase real.
- `cors()` sem opções → libera qualquer origem.
- Ler `req.query` cru depois do `validate(..., 'query')` → use `req.valid.query` (com `page` já numérico).
- Esquecer `Cache-Control: no-store` no `/api/status` → cliente vê "aberto" velho.
- Devolver `error.message` do Supabase/Zod direto → vaza detalhe interno; use `details` estruturado.

## Checklist final
- [ ] Rota nova: factory `xxxRoutes`, `validate` em toda entrada, `asyncHandler`, chama service, status certo (201 em criação, 204 em delete).
- [ ] Erro novo usa um `code` do contrato e status da tabela.
- [ ] Teste de integração com `supertest` + `createApp({ db: fakeRepo, options: { rateLimit: false } })` cobrindo sucesso, 400 e o erro de negócio.
- [ ] Nenhum dado pessoal ou token em log; nenhuma stack na resposta.
- [ ] CSP/CORS continuam restritivos (nada de `'unsafe-inline'`, nada de `origin: '*'`).
