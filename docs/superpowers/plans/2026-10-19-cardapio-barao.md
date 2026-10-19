# Cardápio Web Barão — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o MVP do cardápio web do Barão: cardápio público mobile-first com pizza inteira/meio a meio, adicionais e carrinho; `POST /api/orders` que valida, recalcula o preço no servidor, grava com código `BR-0001` e devolve a mensagem pronta + `whatsappUrl`; e o painel `/admin` (produtos, horários, loja, pedidos, resumo).
**Architecture:** Express 4 com camadas finas (`routes` → `services` puros → `db/repositories`, único ponto que fala com o Supabase), montado por `createApp({ db, options })` com repositório injetado (Supabase real em `src/server.js`, `fakeDb` em memória nos testes). `shared/money.js` e `shared/pricing.js` são o mesmo código no servidor (autoridade) e no browser (preview). Front vanilla com ES modules nativos servido de `public/`; admin autentica no Supabase Auth (ANON key) e chama a API com Bearer.
**Tech Stack:** Node.js 20.6+ (ESM), Express 4, helmet, cors, express-rate-limit 7, multer, zod ^3.23.8, @supabase/supabase-js 2, node:test + node:assert/strict + supertest; HTML/CSS/JS vanilla; Supabase (Postgres + Auth + Storage).
**Spec:** docs/superpowers/specs/2026-10-18-cardapio-barao-design.md

## Global Constraints

- Node **20.6+** (`"engines": { "node": ">=20.6" }`): `module.register` e `String.prototype.toWellFormed` são usados; `"type": "module"`, imports com extensão `.js` explícita.
- Scripts exatos: `dev` = `node --watch --env-file=.env src/server.js`; `start` = `node src/server.js`; `test` = `node --test`. Sem dotenv.
- Dependências fixadas no `package.json` da Tarefa 1 e **não alteradas depois** (zod `^3.23.8`; express-rate-limit v7 usa `limit`, não `max`). Pacote novo exige justificativa no commit.
- Dinheiro = **inteiro em centavos** (`*_cents` no banco, `*Cents` no JSON). Proibido `toFixed`, `parseFloat`, `* 100` em valor. Formatar só na borda com `formatBRL` (espaço comum, nunca U+00A0).
- Fuso **`America/Fortaleza`** em toda conta de horário e filtro de data, via `Intl.DateTimeFormat({ timeZone })`; nunca `getDay()`/`getHours()`; relógio sempre injetado (`options.now()` / parâmetro `now`).
- Servidor recalcula todo preço a partir do banco; qualquer `price*`/`subtotal*` do cliente é descartado pelo Zod (`z.object` faz *strip*, nunca `.strict()`).
- Formato único de erro `{ error: { code, message, details? } }`; códigos só de `STORE_CLOSED | VALIDATION_ERROR | PRODUCT_UNAVAILABLE | PRODUCT_HAS_ORDERS | NOT_FOUND | UNAUTHORIZED | FORBIDDEN | RATE_LIMITED | INTERNAL`; mensagens genéricas = tabela do spec §12; nunca stack/SQL na resposta.
- Nomes exatos do contrato (tabelas, colunas, rotas, enums `pizza|drink|addon`, `delivery|pickup`, `pix|cash|card`, `received|confirmed|canceled`, `auto|open|closed`); banco snake_case, JSON camelCase (conversão só nos repositories).
- Arquivos: `*.routes.js` (factory `xxxRoutes({ db, options })`), `*.service.js`, `*.repo.js`, `*.schema.js`, testes `*.test.js` em `tests/unit` ou `tests/integration`; helpers em `tests/helpers`.
- Identificadores/código/commits técnicos em inglês no código; UI, mensagens de erro e mensagem do WhatsApp em **PT-BR**.
- Front: **nunca `innerHTML`/`insertAdjacentHTML`/`outerHTML` com dados** — só `el()` de `public/js/dom.js`; sem bundler, sem framework, sem framework CSS; nenhum `<script>`/`style=""`/`on*=` inline (CSP `self`); cores/fontes/espaços só via `var(--*)` de `tokens.css`; mobile-first (`min-width`).
- Carrinho em `localStorage['barao:cart:v1']` só com ids/quantidades/observações (formato `{ v: 1, items }` do spec §10.2).
- Número do WhatsApp só de `settings.whatsapp_number` (nunca hardcoded em `src/` ou `public/`); URL `https://wa.me/<n>?text=` + `encodeURIComponent(message)`.
- `SUPABASE_SERVICE_ROLE_KEY` só em `src/db/supabase.js` via env; nunca em `public/`, log ou resposta. Nenhum log com nome, telefone, endereço, mensagem ou header `Authorization`.
- Testes nunca tocam Supabase real nem importam `src/server.js`; integração = `makeApp()` (supertest + `fakeDb`); cada teste cria seu app; `rateLimit: false` exceto nos testes de 429.
- Código de referência das skills (`.claude/skills/barao-*/`) já foi executado; copiar e aplicar **só** os deltas indicados. Onde a skill diverge do spec, vale o spec (deltas listados em cada tarefa).
- Commits pequenos, Conventional Commits em PT-BR, terminando com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (segundo `-m`).
- Antes de cada commit: `npm test` verde (não só o arquivo da tarefa).

## Review Focus

1. **Carrinho antigo no `localStorage`** (produto excluído, esgotado ou com preço alterado desde a última visita; JSON corrompido; `v` ≠ 1): ao carregar o menu, linhas com id inexistente somem com aviso; linhas com produto `available: false` ficam marcadas "Esgotado — remova para continuar" e bloqueiam o checkout; preço exibido é sempre o do menu atual; JSON inválido/versão diferente → carrinho vazio sem exceção. **Teste:** Tarefa 16, `cart.test.js` › "reconcile: carrinho salvo antes de mudanças no cardápio".
2. **Pedido noturno vira o dia UTC seguinte** (loja abre 18:00–23:30 = 21:00–02:30 UTC): pedido às 22:00 de domingo em Fortaleza (`2026-10-19T01:00:00Z`) aparece em Pedidos/Resumo com `from=to=2026-10-18`, não aparece em `2026-10-19`, e o padrão "hoje" sem parâmetros às 22:30 local é `2026-10-18`. **Teste:** Tarefa 12, `admin.orders.test.js` › "pedido às 22:00 local pertence ao dia local" (+ Tarefa 23 `todayInFortaleza` às 22:00 local).
3. **Texto livre hostil** (nome/obs. com emoji, `\n`, tab, surrogate UTF-16 solto vindo de `maxlength` que cortou um emoji ao meio, todos os campos no tamanho máximo): `POST /api/orders` → 201 (nunca 500 depois de salvar), mensagem sem quebras extras (`oneLine`), surrogate solto vira U+FFFD, `decodeURIComponent(text)` = `message`; URL > 4000 caracteres só gera `warn` sem dados pessoais. **Teste:** Tarefa 9, `orders.routes.test.js` › "texto livre hostil não quebra a mensagem nem a URL" (+ Tarefa 5 schema).
4. **Duplo toque / reenvio em "Enviar pedido pelo WhatsApp"**: um único `POST` por envio; botão desabilitado com "Enviando…" até a resposta; carrinho só é limpo no 201; erro de rede/timeout/409/429 preserva o carrinho e reabilita o botão. **Teste:** Tarefa 19, `order-payload.test.js` › "createOrderSubmitter ignora o segundo envio enquanto o primeiro está pendente".
5. **Token do admin expira no meio de uma operação** (upload de foto ou salvar produto após o celular ficar bloqueado): `401` → um `refreshSession()` e repete a **mesma** requisição (mesmo `FormData`, sem `Content-Type` manual); refresh falhou → `signOut()` e volta a `/admin/?motivo=sessao` ("Sua sessão expirou. Entre novamente."); `403` → `?motivo=acesso`; nunca fica "Salvando…" com a página viva. **Teste:** Tarefa 20, `admin-api.test.js` › "401 no upload: refresh e repete o mesmo FormData" e "refresh falhou → logout('sessao')".

---

## Tarefa 1 — Scaffold do projeto + `shared/money.js`

**Files:** Create `package.json`, `package-lock.json` (via npm), `.gitignore`, `.env.example`, `shared/money.js`, `tests/unit/money.test.js`.
**Interfaces:** Produces `formatBRL(cents: safeInteger) → string` (lança `TypeError` se não inteiro) e `parseBRLToCents(input: unknown) → number | null`.
**Depende de:** — · **Paralelizável com:** —

- [ ] `npm init -y`; editar `package.json`: `"name": "barao-cardapio"`, `"private": true`, `"type": "module"`, `"engines": { "node": ">=20.6" }`, scripts exatos das Global Constraints.
- [ ] Instalar tudo de uma vez (nenhuma tarefa posterior mexe no `package.json`): `npm install express@^4.21.2 helmet@^8 cors@^2.8.5 express-rate-limit@^7 multer@^2 zod@^3.23.8 @supabase/supabase-js@^2` e `npm install -D supertest@^7`.
- [ ] `.gitignore`: `node_modules/`, `.env`, `backups/`, `*.log`. `.env.example` com as chaves do spec §16 vazias, exceto `PORT=3000`, `ADMIN_EMAILS=guslolhorta@gmail.com`, `STORE_TIMEZONE=America/Fortaleza`; `TRUST_PROXY=` comentado como opcional.
- [ ] Escrever `tests/unit/money.test.js` (spec §15 casos 1–2):
  ```js
  formatBRL(3499) === 'R$ 34,99'; formatBRL(0) === 'R$ 0,00'; formatBRL(103499) === 'R$ 1.034,99'
  !formatBRL(3499).includes(' '); assert.throws(() => formatBRL(34.99), TypeError)
  parseBRLToCents('34,99') === 3499; ('R$ 100') === 10000; ('50.5') === 5050; ('R$ 1.034,99') === 103499
  parseBRLToCents('') / ('abc') / ('-5') / ('1,999') / (3499) / (null) === null
  ```
- [ ] `node --test tests/unit/money.test.js` → falha com `ERR_MODULE_NOT_FOUND` (`shared/money.js`).
- [ ] Implementar `shared/money.js` copiando "`shared/money.js` (referência completa)" de `barao-cardapio-precos/SKILL.md`. **Delta:** escrever os NBSP como escape — `.replace(/ /g, ' ')` em `formatBRL` e `/[\s ]/g` em `parseBRLToCents` (na skill o caractere literal parece um espaço comum). Sem imports.
- [ ] `npm test` → verde.
- [ ] `git add package.json package-lock.json .gitignore .env.example shared/money.js tests/unit/money.test.js && git commit -m "chore: scaffold do projeto e dinheiro em centavos (shared/money)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

## Tarefa 2 — `shared/pricing.js`

**Files:** Create `shared/pricing.js`, `tests/unit/pricing.test.js`.
**Interfaces:** Produces `LIMITS = { minFlavors: 1, maxFlavors: 2, minQuantity: 1, maxQuantity: 20, maxItems: 30 }` (frozen); `calcPizzaBaseCents(flavors)`; `calcPizzaUnitCents(flavors, addons = [])`; `calcItemCents(item)`; `calcOrderSubtotalCents(items)` — formatos de `item` do spec §3.2.
**Depende de:** 1 · **Paralelizável com:** 3, 4, 5, 13, 15

- [ ] Escrever `tests/unit/pricing.test.js` (spec §15 casos 3–7, tabela §6), usando objetos `{ priceCents }` literais (sem fakeDb):
  - inteira `[{3049}]` → 3049; meio a meio `[3049, 4299]` e `[4299, 3049]` → 4299; `calcPizzaUnitCents([{3049},{3499}], [{450}])` → 3949;
  - `calcItemCents({ kind:'pizza', flavors:[{3999}], addons:[{450},{999}], quantity:2 })` → 10896; drink `{1000}` ×2 → 2000; Guaraná ×3 → 2400;
  - `calcOrderSubtotalCents([pizza 3949 ×1, drink 1000 ×2])` → 5949;
  - `RangeError`: 0 sabores, 3 sabores, quantidade 0, 21, 1.5; `TypeError`: preço 34.99, preço -1, `kind: 'addon'`.
- [ ] `node --test tests/unit/pricing.test.js` → `ERR_MODULE_NOT_FOUND`.
- [ ] Implementar copiando "`shared/pricing.js` (referência completa)" de `barao-cardapio-precos/SKILL.md`, sem alterações e sem imports.
- [ ] `npm test` → verde.
- [ ] `git add shared/pricing.js tests/unit/pricing.test.js && git commit -m "feat: cálculo de preço puro (meio a meio pelo sabor mais caro, addons por pizza)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

## Tarefa 3 — `AppError`, fixtures de teste e `hours.service`

**Files:** Create `src/errors/AppError.js`, `tests/helpers/clock.js`, `tests/helpers/fakeDb.js`, `src/services/hours.service.js`, `tests/unit/hours.service.test.js`.
**Interfaces:**
- Produces `class AppError extends Error { constructor(code, status, message, details?, options?) }` (props `code`, `status`, `details`).
- Produces `createFakeDb(overrides?)`, `IDS`, `CATEGORY_IDS`, `seedProducts()`, `seedCategories()`, `seedHours()`, `CLOSED_WEEKDAYS` (interface `db` do spec §3.1); `fixedNow(iso)`, `SUNDAY_20H`, `SUNDAY_15H`, `SUNDAY_00H15`, `MONDAY_20H`, `TUESDAY_19H`, `THURSDAY_18H`.
- Produces (puro) `DEFAULT_TZ`, `getLocalParts(date, tz)`, `toMinutes(hhmm)`, `isOpenAt(date, hours, override='auto', tz)`, `findNextOpenAt(date, hours, tz) → ISO|null`, `getStoreStatus(now, hours, override='auto', timeZone=DEFAULT_TZ) → { open, reason, nextOpenAt, todayHours }`, `describeNextOpening(nextOpenAt, now, timeZone) → 'hoje às 18:00' | 'amanhã às 18:00' | 'quinta às 18:00'`.
**Depende de:** 1 · **Paralelizável com:** 2, 4, 5, 13, 15

- [ ] Copiar `AppError` de `barao-api-express/reference/app.md`; `clock.js` e `fakeDb.js` de `barao-testes/reference/helpers/` sem alterações.
- [ ] Escrever `tests/unit/hours.service.test.js`: copiar `barao-testes/reference/exemplos/unit/hours.service.test.js` e acrescentar (spec §7 e §15 casos 9–14):
  - tabela do spec §7 completa com sexta 18:00–00:30: sex 23:50 aberto; sáb 00:10 aberto; sáb 00:30 fechado; sex `isClosed` → sáb 00:10 fechado;
  - sáb 23:30 (`2026-10-18T02:30:00Z`) fechado com `nextOpenAt === '2026-10-18T21:00:00.000Z'`; todos os dias `isClosed` → `nextOpenAt === null`; override `closed` → `nextOpenAt === null`, `reason === 'override_closed'`;
  - terça 19:00 → `nextOpenAt === '2026-10-22T21:00:00.000Z'`, `todayHours` deep-equal `{ weekday: 2, opensAt: '18:00', closesAt: '23:30', isClosed: true }`;
  - `describeNextOpening`: (domingo 15:00, domingo 18:00) → `'hoje às 18:00'`; (seg 23:30, qui 18:00) → `'quinta às 18:00'`; (sáb 23:30, dom 18:00) → `'amanhã às 18:00'`;
  - fuso do processo irrelevante (caso 14): `execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ: 'Pacific/Kiritimati' } })` onde o script importa o service e imprime `JSON.stringify(getStoreStatus(new Date('2026-10-20T22:00:00Z'), seed))`; resultado igual ao do processo atual.
- [ ] `node --test tests/unit/hours.service.test.js` → `ERR_MODULE_NOT_FOUND` (`hours.service.js`).
- [ ] Implementar copiando `barao-pedido-whatsapp/reference/hours.service.md`. **Delta:** adicionar `describeNextOpening` (data local de `now` e de `nextOpenAt` via `getLocalParts`; mesmo dia → "hoje", +1 → "amanhã", senão `Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone })` sem o sufixo "-feira"; hora `HH:MM` local). Assinatura posicional da skill (ver Lacunas).
- [ ] `npm test` → verde.
- [ ] `git add src/errors tests/helpers/clock.js tests/helpers/fakeDb.js src/services/hours.service.js tests/unit/hours.service.test.js && git commit -m "feat: horário de funcionamento em America/Fortaleza com turno que vira a meia-noite" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

## Tarefa 4 — `whatsapp.service` (mensagem e URL)

**Files:** Create `src/services/whatsapp.service.js`, `tests/unit/whatsapp.service.test.js`.
**Interfaces:** Consumes `formatBRL`. Produces `oneLine(text) → string`, `formatPhoneBR(phone) → string`, `buildOrderMessage(order) → string` (entrada documentada em `whatsapp.service.md`: `{ code, items: pricedItems, subtotalCents, customer, fulfillment, address|null, payment, notes|null }`), `buildWhatsAppUrl(number, text) → string` (lança se número não tiver 12–13 dígitos).
**Depende de:** 1 · **Paralelizável com:** 2, 3, 5, 13, 15

- [ ] Escrever `tests/unit/whatsapp.service.test.js` copiando o teste de referência de `barao-pedido-whatsapp/reference/whatsapp.service.md` e acrescentando (spec §15 casos 15–21):
  - entrega + cartão sem referência → contém `*Pagamento:* Cartão (maquininha)` e não contém `Ref.:`; dinheiro sem troco → linha exata `*Pagamento:* Dinheiro`;
  - pizza qtd 2 (`baseUnitCents` 3499, addon 450, `lineTotalCents` 7898) → linhas `2x Pizza Calabresa — R$ 69,98` e `   + Borda Recheada com Catupiry — R$ 9,00`;
  - `oneLine('  João\n\tda   Silva ')` → `'João da Silva'`; `oneLine(null)` → `''`; `oneLine('*a* _b_')` preserva `*`/`_`;
  - endereço com `\n` no meio da rua → linha `*Entrega:*` única;
  - `buildWhatsAppUrl('5585997687641', msg)` com `decodeURIComponent(url.split('?text=')[1]) === msg`; `buildWhatsAppUrl('123', 'x')` lança.
- [ ] `node --test tests/unit/whatsapp.service.test.js` → `ERR_MODULE_NOT_FOUND`.
- [ ] Implementar copiando `barao-pedido-whatsapp/reference/whatsapp.service.md` sem deltas (nome `buildWhatsAppUrl`, com "A" maiúsculo).
- [ ] `npm test` → verde.
- [ ] `git add src/services/whatsapp.service.js tests/unit/whatsapp.service.test.js && git commit -m "feat: mensagem do WhatsApp no formato exato do contrato" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

## Tarefa 5 — Schemas Zod

**Files:** Create `src/schemas/order.schema.js`, `src/schemas/product.schema.js`, `src/schemas/hours.schema.js`, `tests/unit/schemas.test.js`.
**Interfaces:** Produces `createOrderSchema`, `orderItemSchema`, `addressSchema`, `ordersQuerySchema` (`{ from?, to?, page }`), `summaryQuerySchema` (`{ from?, to? }`), `orderStatusSchema`, `idParamSchema`; `productCreateSchema`, `productUpdateSchema`, `availabilitySchema`; `hoursSchema`, `settingsSchema`, `WHATSAPP_NUMBER_RE`.
**Depende de:** 1 · **Paralelizável com:** 2, 3, 4, 13, 15

- [ ] Escrever `tests/unit/schemas.test.js` (uuids literais locais, sem fakeDb). `safeParse` → `success === false` com `path` esperado para: sem itens; 31 itens; quantidade 21 e 1.5; 3 sabores; sabores repetidos; addon repetido; delivery sem `address`; telefone `859999999`; nome `'J'`; `notes` com 281 chars; item `notes` 141; `address.number` com 11 chars; `payment.method: 'boleto'`; `changeForCents: -1`. `success === true` e dado limpo para:
  - telefone `'(85) 99999-9999'` → `'85999999999'`; pickup com `address` preenchido → `address === null`;
  - `priceCents`/`subtotalCents` extras somem do resultado; `address.reference: ''` → `null`; `notes: ''` → `null`;
  - nome `'João 🍕\uD83C'` (surrogate solto) → `'João 🍕�'`; `changeForCents: 0` aceito;
  - `hoursSchema`: 7 dias válidos ok; 6 dias, weekday repetido, `'24:00'`, `'9:00'` → falha;
  - `settingsSchema` (spec caso 35): `{ storeOverride: 'open' }` ok; `{ whatsappNumber: '5585988887777' }` ok; `'(85) 98888-7777'`, `'85988887777'`, `'55859888877'` (curto), `'55859888877771'` (longo), `{}` e `{ storeOverride: 'x' }` → falha;
  - `productCreateSchema`: pizza com `addonGroup: 'borda'` → falha `path: ['addonGroup']`; addon com `'borda'` ok; defaults `description: ''`, `available: true`, `sortOrder: 0`, `addonGroup: null`;
  - `productUpdateSchema`: sem `name`/`priceCents`/`categoryId`/`kind` → falha; omitir `description`/`available`/`sortOrder` → chaves ausentes no resultado; `kind: 'pizza'` sem `addonGroup` → `addonGroup === null`;
  - `ordersQuerySchema`: `{}` → `{ page: 1 }`; `from: '2026-02-31'` → falha; `page: '2'` → 2; `page: 0` → falha.
- [ ] `node --test tests/unit/schemas.test.js` → `ERR_MODULE_NOT_FOUND`.
- [ ] Implementar copiando `barao-api-express/reference/schemas.md`. **Deltas (spec manda):**
  - helper `freeText(min, max, msg)` = `z.string().transform((s) => s.toWellFormed()).pipe(z.string().trim().min(min, msg).max(max))`; usar em nome, rua, número, bairro, referência, `notes` (pedido e item);
  - `address.number` máx **10**; `reference` e `notes` opcionais com vazio → `null` (`.optional().transform((v) => v || null)`);
  - `changeForCents: z.number().int().min(0).max(10_000_000).nullable().optional()`;
  - `ordersQuerySchema`/`summaryQuerySchema` com `from`/`to` **opcionais** e `isoDate` que rejeita data inexistente (refine: `new Date(d + 'T00:00:00Z').toISOString().startsWith(d)`); a checagem `from <= to`, os 366 dias e o padrão "hoje" ficam no `dateRange.service` (Tarefa 12);
  - `productUpdateSchema` = `productBase` com `description`, `available`, `sortOrder`, `addonGroup` `.optional()` sem default (spec §5.4: demais obrigatórios) + `groupFitsKind` + transform que zera `addonGroup` quando `kind !== 'addon'` e ele foi omitido.
- [ ] `npm test` → verde.
- [ ] `git add src/schemas tests/unit/schemas.test.js && git commit -m "feat: schemas Zod do pedido, produtos, horários e loja" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

## Tarefa 6 — `pricing.service`

**Files:** Create `src/services/pricing.service.js`, `tests/unit/pricing.service.test.js`.
**Interfaces:** Consumes `AppError`, `shared/pricing.js`, `formatBRL`, `seedProducts`/`IDS`. Produces `collectProductIds(items) → string[]`, `priceOrderItems(items, productsById: Map) → PricedItem[]` (forma documentada em `pricing.service.md`), `assertChangeIsValid(payment, totalCents)`.
**Depende de:** 2, 3 · **Paralelizável com:** 7, 16, 17, 20

- [ ] Escrever `tests/unit/pricing.service.test.js`: copiar o bloco `describe('priceOrderItems (servidor)')` de `barao-testes/reference/exemplos/unit/pricing.test.js` e acrescentar:
  - snapshot de Calabresa/Frango + Borda Catupiry: `description === 'Pizza meio a meio: Calabresa / Frango'`, `productIds` = `[calabresa, frango, bordaCatupiry]`, `flavorNames`, `baseUnitCents 3499`, `unitPriceCents 3949`, `lineTotalCents 3949`; Frango/Calabresa → descrição na ordem enviada;
  - duas bordas → `AppError` `VALIDATION_ERROR` 400, `details[0]` = `{ path: 'items.0.addonIds', message: 'Escolha apenas uma borda por pizza.' }`; borda + Catupiry por cima → ok (5448 com Bacon);
  - esgotado + inexistente no mesmo pedido → um só `PRODUCT_UNAVAILABLE` 409 com `details` `[{ productId, name: 'Bacon' }, { productId, name: null }]` e `message === 'Ops! Bacon acabou por hoje. Remova do carrinho para continuar.'`;
  - `collectProductIds` deduplica ids repetidos entre itens;
  - `assertChangeIsValid({ method: 'cash', changeForCents: 5000 }, 5949)` lança 400 com `message === 'O troco deve ser para um valor igual ou maior que o total do pedido.'`; 10000 ok; `pix` com troco ignorado.
- [ ] `node --test tests/unit/pricing.service.test.js` → `ERR_MODULE_NOT_FOUND`.
- [ ] Implementar copiando `barao-cardapio-precos/reference/pricing.service.md`. **Deltas:** mensagem do `PRODUCT_UNAVAILABLE` = spec §12 com os nomes não nulos unidos por `', '` (sem nome nenhum → `'Ops! Alguns itens acabaram por hoje. Remova do carrinho para continuar.'`); mensagem do troco = spec §6; `notes` do item já chega `null` do schema (manter `|| null`).
- [ ] `npm test` → verde.
- [ ] `git add src/services/pricing.service.js tests/unit/pricing.service.test.js && git commit -m "feat: recálculo do pedido no servidor com uma borda por pizza" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

## Tarefa 7 — Esqueleto HTTP: `createApp`, middlewares, `requireAdmin`, `/api/admin-config`

**Files:** Create `src/app.js`, `src/middleware/{asyncHandler,validate,errorHandler,requestLogger,rateLimit,requireAdmin}.js`, `src/routes/adminConfig.routes.js`, `src/routes/admin/index.js`; **stubs** (cada um exporta a factory e devolve `express.Router()` vazio; serão substituídos pelas tarefas donas): `src/routes/menu.routes.js` (`menuRoutes`), `src/routes/status.routes.js` (`statusRoutes`), `src/routes/orders.routes.js` (`ordersRoutes`), `src/routes/admin/products.routes.js` (`productsRoutes`), `src/routes/admin/hours.routes.js` (`hoursRoutes`), `src/routes/admin/settings.routes.js` (`settingsRoutes`), `src/routes/admin/orders.routes.js` (`adminOrdersRoutes`), `src/routes/admin/reports.routes.js` (`reportsRoutes`); `tests/helpers/testkit.js`; Test `tests/integration/app.test.js`, `tests/integration/admin.auth.test.js`.
**Interfaces:**
- Produces `createApp({ db, options }) → express.Application` com `options = { now, rateLimit, adminEmails, corsOrigin, supabaseUrl, supabaseAnonKey, timeZone, isProduction, trustProxy }` (defaults do env, ver referência).
- Produces `asyncHandler(fn)`, `validate(schema, source='body')` (dado limpo em `req.body` e `req.valid[source]`), `zodDetails(err)`, `errorHandler`, `requestLogger`, `ordersRateLimit({ enabled })` (10/10 min), `adminRateLimit({ enabled })` (300/15 min), `requireAdmin({ db, adminEmails })` (`req.admin = { id, email }`).
- `admin/index.js`: `adminRoutes({ db, options })` monta `/products`, `/hours`, `/settings`, `/orders` (`adminOrdersRoutes`), `/reports` (`reportsRoutes`). Todas as factories recebem `({ db, options })`.
- Produces `makeApp({ now = SUNDAY_20H, options, ...dbOverrides }) → { app, db }`, `validOrder(overrides)`, `ADMIN_EMAILS`, `IDS`, `normalizeSpaces`.
**Depende de:** 3 · **Paralelizável com:** 6, 16, 17, 20

- [ ] Escrever `tests/integration/app.test.js`:
  - `createApp({})` lança `'createApp: db é obrigatório'`;
  - `GET /api/nao-existe` → 404 `{ error: { code: 'NOT_FOUND', message: 'Não encontramos o que você procurou.' } }`;
  - `POST /api/orders` com `'{"a":'` (`Content-Type: application/json`) → 400 `VALIDATION_ERROR`; corpo JSON de 21 kb → **413** `VALIDATION_ERROR`;
  - `GET /api/admin-config` sem token → 200 `{ supabaseUrl: 'https://fake.supabase.co', supabaseAnonKey: 'fake-anon-key' }`, `Cache-Control: public, max-age=300`;
  - header `content-security-policy` contém `frame-ancestors 'none'`, `script-src 'self' https://cdn.jsdelivr.net` e `connect-src 'self' https://fake.supabase.co`; sem `x-powered-by`;
  - `makeApp({ options: { rateLimit: true } })`: 301 `GET /api/admin/x` sem token → a 301ª é 429 `RATE_LIMITED`.
- [ ] Escrever `tests/integration/admin.auth.test.js` copiando `barao-testes/reference/exemplos/integration/admin.auth.test.js` (spec caso 31) **sem** os casos "consegue marcar esgotado" (vai para a Tarefa 11) e "rotas públicas continuam sem exigir token" (vai para a Tarefa 8); os dois casos "autorizado → 200" (maiúsculas e lista com espaços) viram "autorizado passa do `requireAdmin`": `GET /api/admin/qualquer` com `token-dono` → 404 `NOT_FOUND` (não 401/403). Mensagens: 401 `'Sua sessão expirou. Entre novamente.'`, 403 `'Você não tem permissão para acessar esta área.'`.
- [ ] `node --test tests/integration` → `ERR_MODULE_NOT_FOUND` (`src/app.js`).
- [ ] Implementar copiando `barao-api-express/reference/app.md` (AppError já existe) e `testkit.js` de `barao-testes/reference/helpers/`. **Deltas:** mensagens genéricas = spec §12 (`VALIDATION_ERROR` "Confira os dados informados.", `INTERNAL` "Algo deu errado do nosso lado. Tente de novo ou chame no WhatsApp.", `RATE_LIMITED` "Muitas tentativas. Aguarde alguns minutos e tente de novo.", `NOT_FOUND`, 401, 403 como acima); 413 de arquivo mantém "A imagem deve ter no máximo 2 MB."; `ordersRateLimit` é criado **dentro** de `ordersRoutes` (Tarefa 9), aqui só exportado.
- [ ] `npm test` → verde.
- [ ] `git add src/app.js src/middleware src/routes tests/helpers/testkit.js tests/integration/app.test.js tests/integration/admin.auth.test.js && git commit -m "feat: esqueleto da API com formato único de erro e autenticação do admin" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

## Tarefa 8 — `GET /api/menu` e `GET /api/status`

**Files:** Modify (substitui stub) `src/routes/menu.routes.js`, `src/routes/status.routes.js`; Test `tests/integration/public.routes.test.js`.
**Interfaces:** Consumes `db.getMenu`, `db.getHours`, `db.getSettings`, `getStoreStatus`. Produces respostas do spec §5.2 (`menuRoutes({ db })`, `statusRoutes({ db, options })`).
**Depende de:** 3, 7 · **Paralelizável com:** 9, 10, 11, 12, 14, 18, 19, 21, 22, 23

- [ ] Escrever `tests/integration/public.routes.test.js` (spec casos 22–23):
  - menu: ordem de categorias `['classicas','especiais','bebidas','adicionais']`; ordem de clássicas `Mista, Calabresa, Mussarela, Marguerita`; Bacon com `available: false` continua listado com `priceCents 3999`; produto público tem exatamente as chaves `id, kind, name, description, priceCents, imageUrl, available, addonGroup`; bordas `addonGroup 'borda'`, Catupiry por cima `null`; dois produtos com o mesmo `sortOrder` saem por nome; categoria sem produtos omitida; `Cache-Control: public, max-age=30`;
  - status (relógio fixo via `makeApp({ now })`): `SUNDAY_20H` → `{ open: true, reason: 'hours', nextOpenAt: null }`; `TUESDAY_19H` → `open: false`, `nextOpenAt '2026-10-22T21:00:00.000Z'`, `todayHours.weekday 2`; `settings: { storeOverride: 'closed' }` → `reason 'override_closed'`; `'open'` na terça → `open: true`; `Cache-Control: no-store`;
  - `db.getMenu` lançando → 500 `INTERNAL` sem `stack` no corpo;
  - "rotas públicas continuam sem exigir token" (movido de `admin.auth.test.js`): `/api/menu` e `/api/status` → 200 sem `Authorization`.
- [ ] `node --test tests/integration/public.routes.test.js` → falha com 404 (stubs vazios).
- [ ] Implementar `menu.routes.js` copiando `barao-api-express/reference/app.md` → `menu.routes.js`. **Delta:** ordenar produtos por `sortOrder` e depois `name.localeCompare(b, 'pt-BR')` antes de projetar. `status.routes.js`: `getStoreStatus(options.now(), await db.getHours(), (await db.getSettings()).storeOverride, options.timeZone)`, `res.set('Cache-Control', 'no-store')`.
- [ ] `npm test` → verde.
- [ ] `git add src/routes/menu.routes.js src/routes/status.routes.js tests/integration/public.routes.test.js && git commit -m "feat: rotas públicas de cardápio e status da loja" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

## Tarefa 9 — `POST /api/orders` (`order.service`)

**Files:** Create `src/services/order.service.js`; Modify (substitui stub) `src/routes/orders.routes.js`; Test `tests/integration/orders.routes.test.js`, `tests/integration/whatsapp.message.test.js`.
**Interfaces:** Consumes `getStoreStatus`, `describeNextOpening`, `collectProductIds`, `priceOrderItems`, `assertChangeIsValid`, `calcOrderSubtotalCents`, `buildOrderMessage`, `buildWhatsAppUrl`, `createOrderSchema`, `ordersRateLimit`. Produces `createOrder(input, { db, now, timeZone }) → { code, subtotalCents, message, whatsappUrl }`; rota `201`.
**Depende de:** 3, 4, 5, 6, 7 · **Paralelizável com:** 8, 10, 11, 12, 14, 18, 19, 21, 22, 23

- [ ] Escrever os dois testes copiando `barao-testes/reference/exemplos/integration/orders.routes.test.js` e `whatsapp.message.test.js`, e acrescentar (spec casos 24–30):
  - caso 24: `whatsappUrl === 'https://wa.me/5585997687641?text=' + encodeURIComponent(res.body.message)`; `db.state.orders[0].payment` = `{ method: 'cash', changeForCents: 10000 }`; `items[0].addons` = `[{ name: 'Borda Recheada com Catupiry', priceCents: 450 }]`;
  - pix com `changeForCents: 10000` → 201 e `changeForCents === null` salvo;
  - número da loja lido a cada pedido (spec caso 35, lado do pedido): `await db.updateSettings({ whatsappNumber: '5585988887777' })` entre dois POSTs → o segundo `whatsappUrl` começa com `https://wa.me/5585988887777?text=`;
  - `STORE_CLOSED` na terça → `message === 'Estamos fechados agora. Abrimos quinta às 18:00.'`, `details` `[{ nextOpenAt: '2026-10-22T21:00:00.000Z' }]`; override `closed` → `'Estamos fechados no momento.'` sem `details`; nada salvo;
  - inexistente → 409 `PRODUCT_UNAVAILABLE` com `name: null`;
  - `db.getHours` lançando → 500 `INTERNAL`, corpo sem `stack` e sem `' at '`;
  - log sem PII: `t.mock.method(console, 'log')`; após 201 nenhuma chamada contém `'João'`, `'85999999999'` nem `'Rua X'`, e existe uma com `"code":"BR-0001"`;
  - **Review Focus 3** — "texto livre hostil não quebra a mensagem nem a URL": nome `'João\n🍕\uD83C'`, obs. do item `'sem\tcebola\n\n'`, `address.reference` com 120 chars, `notes` 280 chars e 30 itens de pizza com `notes` de 140 chars → 201; `message` contém `'*Cliente:* João 🍕� — (85) 99999-9999'` e `'   Obs.: sem cebola'`; `decodeURIComponent(url.split('?text=')[1]) === message`; `console.warn` chamado uma vez com `msg: 'whatsapp_url_long'` e sem nome/telefone.
- [ ] `node --test tests/integration/orders.routes.test.js` → falha com 404 (stub).
- [ ] Implementar `order.service.js` copiando o bloco de `barao-pedido-whatsapp/SKILL.md`. **Deltas:** mensagem do `STORE_CLOSED` = `Estamos fechados agora. Abrimos ${describeNextOpening(nextOpenAt, now, timeZone)}.` ou `'Estamos fechados no momento.'` (sem `nextOpenAt`, sem `details`); `notes` já vem `null` do schema. `orders.routes.js` copiando o exemplo da mesma skill (`barao-api-express/SKILL.md` → "Rota fina"); **delta:** se `whatsappUrl.length > 4000`, `console.warn(JSON.stringify({ level: 'warn', msg: 'whatsapp_url_long', code, length }))`.
- [ ] `npm test` → verde.
- [ ] `git add src/services/order.service.js src/routes/orders.routes.js tests/integration/orders.routes.test.js tests/integration/whatsapp.message.test.js && git commit -m "feat: criação de pedido com recálculo, código BR e link do WhatsApp" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

## Tarefa 10 — Admin: horários e loja

**Files:** Modify (substitui stub) `src/routes/admin/hours.routes.js`, `src/routes/admin/settings.routes.js`; Test `tests/integration/admin.hours.test.js`, `tests/integration/admin.settings.test.js`.
**Interfaces:** Consumes `hoursSchema`, `settingsSchema`, `db.getHours/updateHours/getSettings/updateSettings`. Produces `GET/PUT /api/admin/hours` → `{ hours }` (7 itens ordenados por `weekday`); `GET/PUT /api/admin/settings` → `{ storeOverride, whatsappNumber, updatedAt }`.
**Depende de:** 5, 7 · **Paralelizável com:** 8, 9, 11, 12, 14, 18, 19, 21, 22, 23

- [ ] Escrever `admin.settings.test.js` copiando `barao-testes/reference/exemplos/integration/admin.settings.test.js` (spec caso 35), **trocando** a asserção "próximo pedido usa no whatsappUrl" (depende da rota da Tarefa 9, mesma onda) por `(await db.getSettings()).whatsappNumber === '5585988887777'` — o lado do pedido fica na Tarefa 9 — + `GET /api/admin/settings` com `token-dono` → 200 (fecha o caso "autorizado → 200" da Tarefa 7) + `PUT { storeOverride: 'closed' }` muda só o override e mantém `whatsappNumber`.
- [ ] Escrever `admin.hours.test.js` (spec caso 34): `GET` → 7 itens, terça `isClosed: true`; `PUT` com sexta `18:00`→`00:30` → 200, `closesAt '00:30'` devolvido e `getStoreStatus(new Date('2026-10-24T03:10:00Z'), db.state.hours).open === true` (sáb 00:10; não depende da rota de status da Tarefa 8); 6 dias, weekday repetido ou `'25:00'` → 400 `VALIDATION_ERROR` e `db.state.hours` inalterado; `PUT` fora de ordem volta ordenado.
- [ ] `node --test tests/integration/admin.hours.test.js tests/integration/admin.settings.test.js` → falha com 404.
- [ ] Implementar `settings.routes.js` copiando `barao-api-express/reference/app.md` → `settings.routes.js`; `hours.routes.js` no mesmo padrão (`validate(hoursSchema)`, responde `{ hours }` ordenado).
- [ ] `npm test` → verde.
- [ ] `git add src/routes/admin/hours.routes.js src/routes/admin/settings.routes.js tests/integration/admin.hours.test.js tests/integration/admin.settings.test.js && git commit -m "feat: admin de horários, override da loja e número do WhatsApp" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

## Tarefa 11 — Admin: produtos (CRUD, disponibilidade, upload, exclusão 409)

**Files:** Create `src/middleware/upload.js`; Modify (substitui stub) `src/routes/admin/products.routes.js`; Modify `tests/helpers/fakeDb.js`; Test `tests/integration/admin.products.test.js`, `tests/integration/admin.upload.test.js`.
**Interfaces:** Consumes `productCreateSchema`, `productUpdateSchema`, `availabilitySchema`, `idParamSchema`, `db.listCategories/listProducts/getProductById/createProduct/updateProduct/deleteProduct/setProductAvailability/uploadProductImage`. Produces `imageUpload` (multer `.single('image')`), `sniffImageType(buf) → mime|null`, `toAdminProduct(product, categoriesById) → AdminProduct` (spec §5.4: inclui `categorySlug`, `createdAt`, `updatedAt`) e as 6 rotas de produto do spec §5.4.
**Depende de:** 5, 7 · **Paralelizável com:** 8, 9, 10, 12, 14, 18, 19, 21, 22, 23

- [ ] `fakeDb.js` (delta): produtos do seed e criados ganham `createdAt`/`updatedAt` (`now().toISOString()`); `patchProduct` atualiza `updatedAt`. Nenhuma outra mudança.
- [ ] Escrever `admin.products.test.js` copiando `barao-testes/reference/exemplos/integration/admin.products.test.js` (spec caso 32) **sem** os casos de `GET /api/admin-config` (já na Tarefa 7), `GET /api/menu` expõe `addonGroup` (Tarefa 8) e "formatos `{ orders }`/`{ order }`" (Tarefa 12); o caso de `PUT` do Catupiry por cima envia o corpo completo (`categoryId`, `kind`, `name`, `priceCents`, `addonGroup`), pois o PUT do spec não é parcial; pedidos criados direto no fake (helper local `seedOrderWith(db, productIds)` que chama `db.createOrder` com um draft de uma linha de bebida ou pizza coerente — `lineTotalCents = unitPriceCents × quantity`), e acrescentar:
  - `GET /api/admin/products` → 16 itens, primeiro `Mista`, cada um com `categorySlug`, `createdAt`, `updatedAt`;
  - `POST` com `categoryId` inexistente → 400 `VALIDATION_ERROR` (`path: 'categoryId'`); `PUT` sem `name` → 400; `PUT` em id inexistente → 404; `PUT` válido → 200 com `priceCents` novo e `db.getProductById` refletindo (sem depender da rota `/api/menu` da Tarefa 8);
  - "admin autorizado consegue marcar produto como esgotado" (movido de `admin.auth.test.js`): `PATCH /:id/availability { available: false }` → 200 e `(await db.getProductById(id)).available === false`; `{ available: 'no' }` → 400; `:id` não-uuid → 400;
  - `DELETE` de bebida e de addon presentes em pedido → 409 `PRODUCT_HAS_ORDERS` com a mensagem exata do spec.
- [ ] Escrever `admin.upload.test.js` (spec caso 33): JPEG válido (`Buffer.from([0xff,0xd8,0xff,0xe0, ...zeros])`, `contentType: 'image/jpeg'`) → 200 e `product.imageUrl` começando com `https://fake.supabase.co/storage/v1/object/public/product-images/products/`; `image/gif` → 400; texto com `contentType: 'image/png'` (assinatura falsa) → 400; 2 MB + 1 byte → 413 `VALIDATION_ERROR`; sem arquivo → 400; produto inexistente → 404.
- [ ] `node --test tests/integration/admin.products.test.js tests/integration/admin.upload.test.js` → falha com 404.
- [ ] Implementar `upload.js` copiando `barao-api-express/reference/app.md` → `upload.js`; rotas conforme a tabela "Rotas (contrato)" e o trecho de DELETE da mesma referência. Decisões: `categoryId` validado contra `db.listCategories()` em POST/PUT; lista ordenada por `sortOrder` da categoria e depois do produto; `POST /:id/image` → `getProductById` (404) antes de `uploadProductImage`, `sniffImageType(req.file.buffer)` diferente do `mimetype` → 400 "Envie uma imagem JPG, PNG ou WebP.".
- [ ] `npm test` → verde.
- [ ] `git add src/middleware/upload.js src/routes/admin/products.routes.js tests/helpers/fakeDb.js tests/integration/admin.products.test.js tests/integration/admin.upload.test.js && git commit -m "feat: admin de produtos com upload de foto e bloqueio de exclusão vendida" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

## Tarefa 12 — Admin: pedidos e resumo

**Files:** Create `src/services/dateRange.service.js`; Modify (substitui stub) `src/routes/admin/orders.routes.js`, `src/routes/admin/reports.routes.js`; Test `tests/integration/admin.orders.test.js`, `tests/integration/admin.reports.test.js`.
**Interfaces:**
- Produces `resolveLocalDateRange({ from, to }, { now, timeZone }) → { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }` (sem parâmetros → hoje local; só um → o outro = ele; `from > to` ou > 366 dias → `AppError VALIDATION_ERROR` 400).
- Produces `toAdminOrderListItem(order)` → `{ id, code, createdAt, customerName, customerPhone, fulfillment, paymentMethod, subtotalCents, status }`; `toAdminOrderDetail(order)` → `{ id, code, status, createdAt, customerName, customerPhone, fulfillment, addressStreet, addressNumber, addressDistrict, addressReference, paymentMethod, changeForCents, notes, subtotalCents, items }` (campos de `orders` em camelCase, spec §5.4).
- Rotas: `GET /api/admin/orders` → `{ orders, page, pageSize: 20, total }`; `GET /:id` → `{ order }`; `PATCH /:id/status` → `{ order }`; `GET /api/admin/reports/summary` → `{ ordersCount, grossCents, topItems }`.
**Depende de:** 5, 6, 7 · **Paralelizável com:** 8, 9, 10, 11, 14, 18, 19, 21, 22, 23

- [ ] Helper local nos testes: `seedOrder(db, items, { status })` = `priceOrderItems(items, new Map((await db.listProducts()).map((p) => [p.id, p])))` + `calcOrderSubtotalCents` → `db.createOrder(draft)` (+ `db.updateOrderStatus` se `status`).
- [ ] Escrever `admin.orders.test.js` (spec caso 36), incluindo o caso "formatos de resposta do admin" de `barao-testes/reference/exemplos/integration/admin.products.test.js` (com `seedOrder` no lugar do `POST`): 25 pedidos no dia → página 1 com 20, página 2 com 5, `total 25`, ordem `createdAt desc`; detalhe com `items[0].addons` e `addressStreet`; `PATCH status 'confirmed'` → 200, `'received'` volta, `'x'` → 400, id inexistente → 404; `from=2026-10-20&to=2026-10-18` → 400; intervalo de 367 dias → 400; detalhe de pickup com `addressStreet: null`. **Review Focus 2** — "pedido às 22:00 local pertence ao dia local": `makeApp({ now: '2026-10-19T01:00:00Z' })`, `seedOrder` → `?from=2026-10-18&to=2026-10-18` lista 1; `?from=2026-10-19&to=2026-10-19` lista 0; sem parâmetros (`now` 22:30 local = `2026-10-19T01:30:00Z`) lista 1.
- [ ] Escrever `admin.reports.test.js` (spec caso 37): 3 pedidos (um cancelado) → `ordersCount 2`, `grossCents` = soma dos 2; `topItems` agrupado por `description`, empate desempata por nome, máximo 10 com 11 descrições distintas; mesma regra de dia local do Review Focus 2.
- [ ] `node --test tests/integration/admin.orders.test.js tests/integration/admin.reports.test.js` → falha com 404.
- [ ] Implementar `dateRange.service.js` (hoje local = `getLocalParts(now, timeZone)` formatado `YYYY-MM-DD`; diferença em dias por `Date.UTC`); rotas finas: `validate(ordersQuerySchema, 'query')` → `resolveLocalDateRange(req.valid.query, { now: options.now(), timeZone: options.timeZone })` → `db.listOrders({ ...range, page, pageSize: 20 })` → mapeia; `null` do repo → 404 `NOT_FOUND`.
- [ ] `npm test` → verde.
- [ ] `git add src/services/dateRange.service.js src/routes/admin/orders.routes.js src/routes/admin/reports.routes.js tests/integration/admin.orders.test.js tests/integration/admin.reports.test.js && git commit -m "feat: histórico de pedidos e resumo de vendas por dia de Fortaleza" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

## Tarefa 13 — Migrations SQL

**Files:** Create `supabase/migrations/0001_schema.sql`, `supabase/migrations/0002_seed_cardapio.sql`.
**Interfaces:** Produces tabelas/funções do spec §4 + `orders_summary(p_from timestamptz, p_to timestamptz) → jsonb` (`{ orders_count, gross_cents, top_items: [{ name, quantity }] }`).
**Depende de:** — (só texto; verificação manual) · **Paralelizável com:** 2, 3, 4, 5, 15

- [ ] `0001_schema.sql` = bloco SQL do spec §4.1 **literal**, acrescentando antes da seção RLS a função `orders_summary` e os `revoke`/`grant` dela, os `revoke all on <tabelas> from anon, authenticated` e `revoke all on sequence public.order_code_seq` — tudo copiado de `barao-supabase/reference/schema.sql`; bucket com `file_size_limit 2097152` e `allowed_mime_types` jpeg/png/webp (versão da referência).
- [ ] `0002_seed_cardapio.sql` = bloco do spec §4.2 literal + `insert into public.settings (id, store_override, whatsapp_number) values (1, 'auto', '5585997687641') on conflict (id) do nothing;`.
- [ ] Verificação (spec caso 38) num projeto Supabase **dev** vazio, SQL Editor: aplicar 0001 e 0002 em ordem sem erro; `select count(*) from products` = 16; `select public.next_order_code()` duas vezes → `BR-0001`, `BR-0002` (depois `alter sequence public.order_code_seq restart with 1;`); `insert` em `orders` com `customer_phone '123'` → erro de check; `select public.orders_summary(now() - interval '1 day', now())` → `{"orders_count":0,"gross_cents":0,"top_items":[]}`; `select public.create_order('{"items":[]}'::jsonb)` → erro `22023`.
- [ ] `git add supabase/migrations && git commit -m "feat: migrations do schema, RLS, sequência BR e seed do cardápio" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

## Tarefa 14 — Repositórios Supabase + `server.js`

**Files:** Create `src/db/supabase.js`, `src/db/repositories/{mappers,menu.repo,orders.repo,store.repo,products.repo,auth.repo,index}.js`, `src/server.js`; Test `tests/unit/mappers.test.js`, `tests/unit/repository.contract.test.js`.
**Interfaces:** Produces `createSupabaseClient({ url, serviceRoleKey })`, `createRepository(supabase)` com exatamente os 20 métodos da interface `db` (spec §3.1); `toProduct`, `toOrder`, `dbError(op, error)`, `localDayRangeToIso(from, to) → { fromIso, toIso }`.
**Depende de:** 3, 7, 13 · **Paralelizável com:** 8, 9, 10, 11, 12, 18, 19, 21, 22, 23

- [ ] Escrever `tests/unit/mappers.test.js`: `localDayRangeToIso('2026-10-18','2026-10-18')` → `{ fromIso: '2026-10-18T03:00:00.000Z', toIso: '2026-10-19T03:00:00.000Z' }`; `toProduct` de linha snake_case com `addon_group: null`, `created_at`, `updated_at` → camelCase com `createdAt`/`updatedAt`; `toOrder` de pickup → `address: null`; `dbError('op', { message: 'x', code: '23514' })` → `AppError INTERNAL 500` com `cause.pgCode === '23514'`.
- [ ] Escrever `tests/unit/repository.contract.test.js`: `Object.keys(createRepository(stubSupabase)).sort()` deep-equal `Object.keys(createFakeDb()).filter((k) => k !== 'state').sort()` (stub = objeto com `from/rpc/storage/auth` vazios; nenhuma chamada de rede).
- [ ] `node --test tests/unit/mappers.test.js tests/unit/repository.contract.test.js` → `ERR_MODULE_NOT_FOUND`.
- [ ] Implementar copiando `barao-supabase/reference/repositories.md` e `src/server.js` de `barao-api-express/reference/app.md`. **Deltas:** completar `listCategories` (ordem `sort_order`), `listProducts` (join `categories(sort_order)`, ordena por categoria e `sort_order`), `getProductById` (`maybeSingle`), `createProduct` (`insert(toRow).select().single()`); colunas de admin incluem `created_at, updated_at` (`ADMIN_PRODUCT_COLUMNS`) mapeadas em `toProduct`; `getMenu` também ordena produtos por `name`; `deleteProduct` remove a imagem antiga do bucket (best effort, caminho após `/product-images/`) e `uploadProductImage` remove a anterior após sucesso.
- [ ] `npm test` → verde.
- [ ] Smoke test manual contra o Supabase dev (`.env` preenchido, usuário admin criado em Auth → Users, signup público desligado): `npm run dev`, depois
  ```bash
  curl -s localhost:3000/api/menu | head -c 300
  curl -s localhost:3000/api/status
  curl -s -X POST localhost:3000/api/orders -H 'Content-Type: application/json' -d @tmp/pedido.json   # ids reais do /api/menu; 201 ou 409 STORE_CLOSED conforme a hora
  curl -s localhost:3000/api/admin/settings                                                          # 401
  TOKEN=$(curl -s "$SUPABASE_URL/auth/v1/token?grant_type=password" -H "apikey: $SUPABASE_ANON_KEY" -H 'Content-Type: application/json' -d '{"email":"guslolhorta@gmail.com","password":"..."}' | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).access_token))")
  curl -s localhost:3000/api/admin/orders -H "Authorization: Bearer $TOKEN"
  curl -s -X POST localhost:3000/api/admin/products/<id>/image -H "Authorization: Bearer $TOKEN" -F image=@foto.webp
  ```
  Conferir no painel Supabase: pedido + itens gravados, imagem no bucket, URL pública abre. Apagar os dados de teste depois.
- [ ] `git add src/db src/server.js tests/unit/mappers.test.js tests/unit/repository.contract.test.js && git commit -m "feat: repositórios Supabase e servidor de produção" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

## Tarefa 15 — Front base: tokens, `dom.js`, `api.js`, `index.html`, orquestrador

**Files:** Create `public/index.html`, `public/css/tokens.css`, `public/css/base.css`, `public/js/dom.js`, `public/js/api.js`, `public/js/app.js`; **stubs** (exportam a assinatura abaixo sem comportamento): `public/js/cart.js`, `public/js/menu.js`, `public/js/product-modal.js`, `public/js/checkout.js`; `tests/helpers/browserAliases.js`, `tests/helpers/browserAliases.hooks.js`; Test `tests/unit/front/api.test.js`.
**Interfaces (contrato entre módulos do front — as tarefas 16–19 implementam exatamente isto):**
- `dom.js`: `el(tag, attrs, ...children)`, `render(container, ...children)`, `$`, `$$`, `announce(region, text)`, `openDialog(dialog, { onClose, initialFocus })`.
- `api.js`: `request(path, { method='GET', body, timeoutMs=10000 }) → Promise<{ ok: true, status, data } | { ok: false, error: { status, code, message, details } }>` (nunca rejeita); `getMenu()`, `getStatus()`, `createOrder(payload)`.
- `cart.js`: `createCart({ storage = globalThis.localStorage }) → Cart` (Tarefa 16).
- `menu.js`: `renderMenu(root, tabsRoot, menu, { storeOpen, onOpenPizza(product), onAddDrink(product) })`, `renderMenuLoading(root)`, `renderMenuError(root, onRetry)`, `renderStoreStatus({ badge, banner }, status, now = new Date())`.
- `product-modal.js`: `openPizzaModal(dialog, product, { menu, productsById, onAdd(item) })`.
- `checkout.js`: `initCheckout({ cart, getProductsById, getStatus, reloadMenu, onStoreClosed }) → { refresh() }`.
- `tests/helpers/browserAliases.js`: efeito colateral `module.register('./browserAliases.hooks.js', import.meta.url)`; o hook `resolve` mapeia especificadores que começam com `/shared/` para `file://<raiz>/shared/...`. Testes do front: `import '../../helpers/browserAliases.js'` e depois `await import(...)` do módulo.
**Depende de:** 1 · **Paralelizável com:** 2, 3, 4, 5, 13

- [ ] Escrever `tests/unit/front/api.test.js` (substituindo `globalThis.fetch` por fakes): 201 JSON → `{ ok: true, status: 201, data }`; 409 `{ error: { code: 'STORE_CLOSED', message, details } }` → `{ ok: false, error: { status: 409, code: 'STORE_CLOSED', ... } }`; 502 com HTML → `code 'INTERNAL'` e mensagem genérica; `fetch` rejeitando → `code 'NETWORK'`, `message 'Sem conexão. Verifique sua internet e tente de novo.'`; `fetch` que nunca resolve com `timeoutMs: 20` → `code 'NETWORK'` (abort via `AbortController`); `createOrder(p)` envia `POST` com `Content-Type: application/json` e `JSON.stringify(p)`.
- [ ] `node --test tests/unit/front/api.test.js` → `ERR_MODULE_NOT_FOUND`.
- [ ] Implementar: `tokens.css` e `dom.js` copiando `barao-ui-identidade/reference/`; `api.js` a partir do trecho "api.js (referência)" da skill **com o delta do spec §10.1** (devolve `{ ok, ... }` em vez de lançar; timeout 10 s); `index.html` a partir do esqueleto de `reference/telas.md` com deltas: sem `<img>` de logo (arquivos de marca pendentes) → wordmark "BARÃO" em `--font-display` + slogan "Peça agora e saboreie!" em `--font-script`; `<svg hidden>` com `<symbol id="ph-pizza">` e `<symbol id="ph-drink">` (cores por classe/tokens); `<section id="status-banner">` com mascote omitido até chegar o arquivo. `base.css`: reset, fundo com `--texture-noise`, tipografia, `.btn`, `.btn--primary`, `.btn-icon` (≥ `--tap-min`), `:focus-visible` 3px `--color-focus`, `.skip-link`, `.toast`, `dialog.modal`/`.drawer` (padding 0 + wrapper), campos de formulário (`font-size: var(--fs-md)`), `.badge`, `.skeleton`, `body.is-locked`, `@media (prefers-reduced-motion: reduce)`.
- [ ] `app.js` (orquestrador, sem regra de negócio): `Promise.all([getMenu(), getStatus()])`; `renderMenuLoading` antes; erro → `renderMenuError(root, retry)` (sem link de WhatsApp, ver Lacunas); sucesso → `productsById` (Map id → produto), `cart.reconcile(productsById)` com toast se `removed > 0`, `renderMenu`, `renderStoreStatus`, `initCheckout`; bebida → `cart.add({ kind: 'drink', productId, quantity: 1 })` + toast "`<nome>` adicionada"; pizza → `openPizzaModal`; `getStatus()` a cada 60 s e em `visibilitychange` visível, re-renderizando status e `storeOpen`.
- [ ] `npm test` → verde; `npm run dev` sem `.env` não sobe (esperado) — validar o HTML com `node -e "import('./src/app.js').then(async ({createApp})=>{const {createFakeDb}=await import('./tests/helpers/fakeDb.js');createApp({db:createFakeDb()}).listen(3000)})"` e abrir `http://localhost:3000` a 360 px: wordmark, abas vazias, esqueleto sem erro no console.
- [ ] `git add public/index.html public/css/tokens.css public/css/base.css public/js tests/helpers/browserAliases.js tests/helpers/browserAliases.hooks.js tests/unit/front/api.test.js && git commit -m "feat: base do front (tokens, DOM seguro, cliente da API e orquestrador)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

## Tarefa 16 — Carrinho (`cart.js`)

**Files:** Modify (substitui stub) `public/js/cart.js`; Test `tests/unit/front/cart.test.js`.
**Interfaces:** Consumes `/shared/pricing.js`. Produces `STORAGE_KEY = 'barao:cart:v1'`, `MAX_LINES = 30`, `MAX_QTY = 20`, `lineKey(item) → 'p:<ids ordenados com +>|a:<ids ordenados com +>' | 'd:<id>'`, `lineId(line) → \`${key}|n:${notes ?? ''}\``, `createCart({ storage }) → { getItems(), count(), add(item) → { ok } | { ok: false, reason: 'CART_FULL' }, setQuantity(lineId, q), remove(lineId), clear(), reconcile(productsById) → { removed: number, unavailable: string[] }, isBlocked(productsById) → boolean, lineTotalCents(line, productsById), subtotalCents(productsById), describe(line, productsById), toOrderItems(), subscribe(fn) → unsubscribe }`.
**Depende de:** 2, 15 · **Paralelizável com:** 6, 7, 17, 20

- [ ] Escrever `tests/unit/front/cart.test.js` (storage fake = `Map` com `getItem/setItem`; menu = `seedProducts()` do fakeDb indexado por id):
  - persistência no formato exato `{ v: 1, items: [{ key, kind, flavorIds, addonIds, quantity, notes }] }` (sem preço/nome); bebida `{ key: 'd:<id>', kind, productId, quantity }`;
  - mesma pizza sem obs. soma quantidade (teto 20); `[frango, calabresa]` e `[calabresa, frango]` têm o mesmo `key`; obs. diferente → linhas separadas; 31ª linha → `{ ok: false, reason: 'CART_FULL' }`;
  - `subtotalCents` de Calabresa/Frango + borda ×1 e Coca 1L Zero ×2 → 5949;
  - `toOrderItems()` sem `key` e no formato do body de `POST /api/orders`;
  - **Review Focus 1** — "reconcile: carrinho salvo antes de mudanças no cardápio": storage pré-carregado com Mista (id removido do menu), Bacon (agora `available: false`) e Frango (preço mudou para 3999) → `reconcile` devolve `{ removed: 1, unavailable: [lineId do Bacon] }`; `isBlocked` → `true`; `lineTotalCents` do Frango = 3999; depois de `remove` do Bacon, `isBlocked` → `false`; storage com `'{'`, `{ v: 2, items: [...] }` ou `setItem` lançando → carrinho vazio/em memória sem exceção.
- [ ] `node --test tests/unit/front/cart.test.js` → falha (stub sem `createCart` funcional).
- [ ] Implementar a partir de `barao-ui-identidade/reference/cart.js`. **Deltas (spec §10.2):** fábrica `createCart({ storage })` em vez de estado de módulo; formato `{ v: 1, items }` com `key`; identidade por `lineId`; `reconcile` remove só id inexistente/kind errado/estrutura inválida/duas bordas e **mantém** `available: false` marcado em `unavailable`; `splitAddons` sai daqui (vai para a Tarefa 18); todo acesso ao storage em `try/catch`.
- [ ] `npm test` → verde.
- [ ] `git add public/js/cart.js tests/unit/front/cart.test.js && git commit -m "feat: carrinho persistente com reconciliação contra o cardápio" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

## Tarefa 17 — Cardápio, cards, placeholder e status da loja

**Files:** Modify (substitui stub) `public/js/menu.js`; Create `public/css/menu.css`; Test `tests/unit/front/menu.test.js`.
**Interfaces:** Produces as 4 funções de render do contrato da Tarefa 15 + puras `describeNextOpening(nextOpenAt, now) → string` e `storeBannerText(status, now) → string | null`.
**Depende de:** 15 · **Paralelizável com:** 6, 7, 16, 20

- [ ] Escrever `tests/unit/front/menu.test.js`: `storeBannerText({ open: true })` → `null`; terça 19:00 com `nextOpenAt '2026-10-22T21:00:00.000Z'` → `'Estamos fechados agora — abrimos quinta às 18:00.'`; domingo 15:00 com abertura às 18:00 do mesmo dia → `'… abrimos hoje às 18:00.'`; `reason 'override_closed'` → `'Estamos fechados no momento.'`; resultado igual com `process.env.TZ` diferente (formatação via `Intl` com `timeZone: 'America/Fortaleza'`).
- [ ] `node --test tests/unit/front/menu.test.js` → falha (stub).
- [ ] Implementar a partir de `barao-ui-identidade/SKILL.md` → "Card de produto (menu.js)" e `reference/telas.md` (abas sticky com `IntersectionObserver`, seções com `scroll-margin-top`, categoria `adicionais` não renderizada). **Deltas (spec §10.5):** loja fechada → botões de adicionar `disabled` (não só o checkout); esgotado com `aria-label` "`<nome>` esgotado", sem abrir modal; skeleton com 4 cards; erro com "Não conseguimos carregar o cardápio. Verifique sua internet." + "Tentar de novo". `menu.css` só com tokens.
- [ ] `npm test` → verde; verificação manual (`app` com fakeDb como na Tarefa 15) a 360 px: 3 seções, cards sem foto com placeholder 88×88 sem layout shift, Bacon esgotado (via `db.setProductAvailability` no script) com selo, selo ABERTO/FECHADO com relógio do sistema.
- [ ] `git add public/js/menu.js public/css/menu.css tests/unit/front/menu.test.js && git commit -m "feat: cardápio com abas, cards, placeholder SVG e selo da loja" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

## Tarefa 18 — Modal da pizza

**Files:** Modify (substitui stub) `public/js/product-modal.js`; Modify `public/css/menu.css` (seção "modal da pizza"); Test `tests/unit/front/product-modal.test.js`.
**Interfaces:** Consumes `calcItemCents`, `formatBRL`, `openDialog`, `el`. Produces `openPizzaModal(dialog, product, { menu, productsById, onAdd })` + puras `secondFlavorOptions(menu, firstId) → Product[]`, `splitAddons(addons) → { groups: Map<string, Product[]>, free: Product[] }`, `readSelection(formData, firstFlavorId) → { kind: 'pizza', flavorIds, addonIds, quantity, notes, incomplete }`.
**Depende de:** 16, 17 · **Paralelizável com:** 8, 9, 10, 11, 12, 14, 19, 21, 22, 23

- [ ] Escrever `tests/unit/front/product-modal.test.js` (menu = resposta de `/api/menu` montada do seed; `FormData` nativo do Node): `secondFlavorOptions(menu, calabresa)` tem 7 pizzas (clássicas + especiais), sem Calabresa e sem esgotadas; `splitAddons` → grupo `borda` com 2, `free` com Catupiry por cima; `readSelection` com `mode=half` sem `second` → `incomplete: true`; `addon-group:borda=""` → nenhuma borda; borda + `addon=<catupiryCima>` → 2 addons; `quantity` `'0'`/`'25'` → 1/20; `notes` com 200 chars → 140; preço ao vivo `calcItemCents` da seleção Calabresa/Frango + borda = 3949 → `'R$ 39,49'`.
- [ ] `node --test tests/unit/front/product-modal.test.js` → falha (stub).
- [ ] Implementar a partir de `barao-ui-identidade/SKILL.md` → "Preço ao vivo no modal" e `reference/telas.md` → "Modal da pizza". Decisões do spec §10.3: título com `tabindex="-1"` recebe o foco (`openDialog(..., { initialFocus: title })`); radio "Sem borda" default; texto "Na meio a meio vale o preço do sabor mais caro."; botão "Adicionar — R$ 39,49" desabilitado em meio a meio sem 2º sabor; só addons disponíveis.
- [ ] `npm test` → verde; manual: teclado (Tab preso, Esc fecha, foco volta ao card), duas bordas impossíveis.
- [ ] `git add public/js/product-modal.js public/css/menu.css tests/unit/front/product-modal.test.js && git commit -m "feat: modal da pizza inteira ou meio a meio com borda única" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

## Tarefa 19 — Carrinho (drawer), checkout e confirmação

**Files:** Modify (substitui stub) `public/js/checkout.js`; Create `public/js/order-payload.js`, `public/css/cart.css`; Test `tests/unit/front/order-payload.test.js`.
**Interfaces:** Produces `initCheckout(...)` (contrato da Tarefa 15) + puras em `order-payload.js`: `onlyDigits(s)`, `maskPhone(value)`, `class FieldError { field, message }`, `buildOrderPayload(fields: Record<string,string>, items, subtotalCents) → body de POST /api/orders` (lança `FieldError`), `fieldErrorsFromDetails(details) → { [field]: message }` (mapeia `customer.phone` → `phone`, `address.street` → `street`, etc.), `createOrderSubmitter({ createOrder, onSuccess, onError }) → { submit(payload) → Promise<void>, get pending() }`.
**Depende de:** 15, 16 · **Paralelizável com:** 8, 9, 10, 11, 12, 14, 18, 21, 22, 23

- [ ] Escrever `tests/unit/front/order-payload.test.js`: `maskPhone('85999999999')` → `'(85) 99999-9999'`, `('8532221111')` → `'(85) 3222-1111'`; pickup → sem `address`; delivery com rua vazia → `FieldError('street')`; pix com troco digitado → sem `changeForCents`; cash `'100'` → `changeForCents 10000`; cash `'50'` com subtotal 5949 → `FieldError('changeFor', 'O troco deve ser maior ou igual ao total.')`; `'abc'` → `FieldError('changeFor')`; telefone mascarado vira só dígitos; `notes` vazio omitido; `fieldErrorsFromDetails([{ path: 'customer.phone', message: 'm' }])` → `{ phone: 'm' }`. **Review Focus 4** — "createOrderSubmitter ignora o segundo envio enquanto o primeiro está pendente": `createOrder` fake com promessa controlada; `submit` duas vezes → `createOrder` chamado 1×, `pending === true` até resolver; `{ ok: true }` → `onSuccess` 1×; `{ ok: false, error: { code: 'NETWORK' } }` → `onError` 1× e `pending === false` (novo `submit` permitido).
- [ ] `node --test tests/unit/front/order-payload.test.js` → `ERR_MODULE_NOT_FOUND`.
- [ ] Implementar `order-payload.js` a partir de `barao-ui-identidade/SKILL.md` → "Máscara de telefone e payload" (recebendo `fields` simples em vez de `FormData`); `checkout.js` conforme `reference/telas.md` (drawer, checkout, confirmação) e spec §10.4–10.5: aviso Pix "A chave Pix será enviada pelo WhatsApp após o pedido" no checkout e na confirmação; "Taxa de entrega a combinar pelo WhatsApp" só em entrega; "Finalizar pedido" desabilitado com loja fechada ou `cart.isBlocked`; botão "Enviar pedido pelo WhatsApp" → "Enviando…" via `createOrderSubmitter`; 201 → `cart.clear()`, tela "Pedido BR-0427 registrado!" com `subtotalCents` **da resposta**, link `Abrir WhatsApp` (`el('a', { href: whatsappUrl, rel: 'noopener' })`) e `window.location.href = whatsappUrl`; 400 → erros por campo (`aria-describedby`, foco no 1º); 409 `STORE_CLOSED` → `onStoreClosed()` + mensagem da API; 409 `PRODUCT_UNAVAILABLE` → `reloadMenu()` e drawer com aviso; 429/NETWORK → mensagem, carrinho mantido. Carrinho vazio: "Seu carrinho está vazio. Bateu a fome? Escolha uma pizza.".
- [ ] `npm test` → verde; manual no app com fakeDb: pedido entrega+troco e retirada+pix até a confirmação (WhatsApp abre com o texto).
- [ ] `git add public/js/checkout.js public/js/order-payload.js public/css/cart.css tests/unit/front/order-payload.test.js && git commit -m "feat: checkout com envio único e abertura do WhatsApp" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

## Tarefa 20 — Admin: login, sessão, `adminApi` e shell do painel

**Files:** Create `public/admin/index.html`, `public/admin/painel.html`, `public/admin/js/auth.js`, `public/admin/js/admin-api.js`, `public/admin/js/ui.js`, `public/admin/js/painel.js`, `public/css/admin.css`; **stubs** `public/admin/js/{products,hours,store,orders,summary}.js` (cada um `export function mount(container, ctx) {}`); Test `tests/unit/front/admin-api.test.js`.
**Interfaces:**
- `admin-api.js` (sem import de CDN, testável): `class AdminApiError { status, code, message, details }`; `createAdminApi({ fetchImpl, getAccessToken, refreshSession, logout }) → adminApi(path, { method, body })` (JSON ou `FormData`; 204 → `null`; 401 → um `refreshSession()` e repete; 401 de novo/refresh falhou/sem token → `logout('sessao')`; 403 → `logout('acesso')`); `withSaving(button, action, { toast })`.
- `auth.js` (importa `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm`): `getSupabase()`, `login(email, password)`, `logout(reason)` (nunca resolve), `requireSession()`, e `adminApi` já montado com `createAdminApi`.
- `ui.js`: `toast(message, kind)`, `confirmDialog({ title, body, confirmLabel, danger }) → Promise<boolean>`.
- Cada tela: `mount(container, { adminApi, toast, confirmDialog, withSaving })`.
**Depende de:** 15 · **Paralelizável com:** 6, 7, 16, 17

- [ ] Escrever `tests/unit/front/admin-api.test.js` (fakes de `fetchImpl`, `getAccessToken`, `refreshSession`, `logout` que registra o motivo e devolve promessa pendente): GET 200 → dados com header `Authorization: Bearer t1`; JSON envia `Content-Type: application/json`; 204 → `null`; 400 → `AdminApiError` com `code`/`details`; rede → `code 'NETWORK'`. **Review Focus 5** — "401 no upload: refresh e repete o mesmo FormData": 1ª resposta 401, `refreshSession` ok e token `t2` → 2ª chamada com o **mesmo** objeto `FormData`, sem header `Content-Type`, `Authorization: Bearer t2`, resultado da 2ª; "refresh falhou → logout('sessao')": `logout` chamado 1× com `'sessao'` e `fetchImpl` 1×; 403 → `logout('acesso')`; `withSaving` restaura texto/`disabled` do botão após erro.
- [ ] `node --test tests/unit/front/admin-api.test.js` → `ERR_MODULE_NOT_FOUND`.
- [ ] Implementar a partir de `barao-painel-admin/reference/auth-e-api.js` (separando em `auth.js` + `admin-api.js` com injeção) e `reference/telas-admin.md` (login e navegação). Decisões do spec §11.1: após `signInWithPassword`, `GET /api/admin/settings`; 403 → `signOut()` + "Este e-mail não tem acesso ao painel."; `?motivo=sessao` → "Sua sessão expirou. Entre novamente."; erro de login genérico "E-mail ou senha inválidos."; botão "Sair". `painel.js`: barra inferior com 5 abas (Pedidos · Produtos · Horários · Loja · Resumo), hash na URL, aba inicial Pedidos, faixa "Loja forçada FECHADA/ABERTA" quando `storeOverride !== 'auto'`. `admin.css` com **todas** as classes que as telas 21–23 usarão: `.admin-card`, `.admin-list`, `.switch`, `.status-pill--received|confirmed|canceled`, `.bottom-nav`, `.stat-block`, `.form-row`, `.field-error`, `.override-banner`, `.radio-card`, `.btn--danger` (alvos ≥ 48px). Páginas com `<meta name="robots" content="noindex">`.
- [ ] `npm test` → verde; manual com Supabase dev: login ok, e-mail fora de `ADMIN_EMAILS` volta com a mensagem, apagar `barao-admin-auth` do `sessionStorage` e clicar numa aba → login com "Sua sessão expirou".
- [ ] `git add public/admin public/css/admin.css tests/unit/front/admin-api.test.js && git commit -m "feat: login do painel e cliente autenticado da API admin" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

## Tarefa 21 — Admin: tela Produtos

**Files:** Modify (substitui stub) `public/admin/js/products.js`; Test `tests/unit/front/admin-products.test.js`.
**Interfaces:** Produces `mount(container, ctx)` + puras `kindForCategory(slug) → 'pizza'|'drink'|'addon'`, `productPayload(fields, categories) → body de POST/PUT` (lança `{ field, message }` com preço inválido), `groupByCategory(products, categories)`.
**Depende de:** 20 · **Paralelizável com:** 8, 9, 10, 11, 12, 14, 18, 19, 22, 23

- [ ] Escrever o teste: `productPayload` com preço `'34,99'` → `priceCents 3499`; `'abc'` → erro `{ field: 'price', message: 'Preço inválido. Ex.: 34,99' }`; categoria `adicionais` com grupo `'borda'` → `{ kind: 'addon', addonGroup: 'borda' }`; categoria `classicas` com grupo marcado → `addonGroup: null`; sempre envia `kind`; `kindForCategory('bebidas') === 'drink'`.
- [ ] Rodar → falha (stub). Implementar a partir de `barao-painel-admin/SKILL.md` (preço, toggle otimista, upload com preview) e `reference/telas-admin.md` → Produtos; 409 `PRODUCT_HAS_ORDERS` → mensagem da API + botão "Marcar como esgotado"; upload só após o produto existir.
- [ ] `npm test` → verde; manual com Supabase dev: editar preço, esgotar (reflete no site), foto > 2 MB bloqueada, excluir produto vendido → 409 tratado.
- [ ] `git add public/admin/js/products.js tests/unit/front/admin-products.test.js && git commit -m "feat: tela de produtos do painel" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

## Tarefa 22 — Admin: telas Horários e Loja

**Files:** Modify (substituem stubs) `public/admin/js/hours.js`, `public/admin/js/store.js`; Test `tests/unit/front/admin-store.test.js`.
**Interfaces:** Produces `mount` de cada tela + puras `describeShift({ opensAt, closesAt, isClosed }) → string | null`, `maskPhoneBR(value)`, `toWhatsAppDigits(value) → string | null`.
**Depende de:** 20 · **Paralelizável com:** 8, 9, 10, 11, 12, 14, 18, 19, 21, 23

- [ ] Escrever o teste: `describeShift` 18:00→00:30 → `'18:00 até 00:30 do dia seguinte'`; 18:00→23:30 → `'18:00 até 23:30'`; fechado → `'Fechado'`; abre = fecha → `null`; `toWhatsAppDigits('(85) 98888-7777')` → `'5585988887777'`; `'+55 85 98888-7777'` → mesmo; `'(85) 9888'` → `null`; `maskPhoneBR('5585997687641')` → `'(85) 99768-7641'`.
- [ ] Rodar → falha. Implementar a partir de `barao-painel-admin/SKILL.md` ("Horários", "Confirmação para ação crítica", "Loja: número do WhatsApp") e `reference/telas-admin.md` → Horários/Loja: um `PUT /api/admin/hours` com os 7 dias; abre = fecha → erro no campo e não envia; Loja mostra `GET /api/status`, 3 radio cards, confirmação ao forçar aberta/fechada, `PUT` só com o campo alterado, "Salvo ✓".
- [ ] `npm test` → verde; manual: forçar fechada → site mostra fechado e API recusa; trocar número → próximo pedido abre `wa.me/<novo>`.
- [ ] `git add public/admin/js/hours.js public/admin/js/store.js tests/unit/front/admin-store.test.js && git commit -m "feat: telas de horários e loja do painel" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

## Tarefa 23 — Admin: telas Pedidos e Resumo

**Files:** Modify (substituem stubs) `public/admin/js/orders.js`, `public/admin/js/summary.js`; Test `tests/unit/front/admin-orders.test.js`.
**Interfaces:** Produces `mount` de cada tela + puras `todayInFortaleza(date) → 'YYYY-MM-DD'`, `presetRange(preset: 'hoje'|'ontem'|'7dias'|'mes', now) → { from, to }`, `formatTimeFortaleza(iso) → 'HH:MM'`, `STATUS_LABEL = { received: 'Recebido', confirmed: 'Confirmado', canceled: 'Cancelado' }`.
**Depende de:** 20 · **Paralelizável com:** 8, 9, 10, 11, 12, 14, 18, 19, 21, 22

- [ ] Escrever o teste: `todayInFortaleza(new Date('2026-10-19T01:30:00Z'))` → `'2026-10-18'` (Review Focus 2, lado do painel); `presetRange('7dias', domingo 20:00)` → `{ from: '2026-10-12', to: '2026-10-18' }`; `'mes'` → `{ from: '2026-10-01', to: '2026-10-18' }`; `'ontem'` → `'2026-10-17'` nos dois; `formatTimeFortaleza('2026-10-19T01:00:00Z')` → `'22:00'`.
- [ ] Rodar → falha. Implementar a partir de `reference/telas-admin.md` → Pedidos/Resumo com os campos do spec §5.4 (lista plana `customerName`, `paymentMethod`…; detalhe com `addressStreet`…). **Delta (spec §11.2):** ações Confirmar / Cancelar (com confirmação) / **Voltar para recebido**; "Abrir conversa" = `https://wa.me/55${customerPhone}`; `received` em destaque; "Carregar mais"; botão "Atualizar" + `visibilitychange` (sem polling). Resumo: períodos hoje/7 dias/mês/personalizado; nota "sem taxa de entrega; exclui pedidos cancelados".
- [ ] `npm test` → verde; manual: pedido feito no site aparece, confirmar/cancelar/voltar funcionam, resumo bate com a lista.
- [ ] `git add public/admin/js/orders.js public/admin/js/summary.js tests/unit/front/admin-orders.test.js && git commit -m "feat: telas de pedidos e resumo do painel" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

## Tarefa 24 — Hardening, verificação final e documento de deploy

**Files:** Modify `src/app.js`; Create `tests/integration/security.test.js`, `docs/DEPLOY.md`.
**Interfaces:** `createApp` passa a servir estáticos com `Cache-Control`: `.html` → `no-cache`; `/js`, `/css`, `/shared`, `/img` → `public, max-age=3600`.
**Depende de:** 8–12, 14, 17–19, 21–23 · **Paralelizável com:** —

- [ ] Escrever `tests/integration/security.test.js`: CSP completa do spec §13 (cada diretiva, incluindo `img-src 'self' data: https://fake.supabase.co` e `style-src 'self' https://fonts.googleapis.com`); CORS: `Origin: https://evil.example` → sem `access-control-allow-origin`, `Origin: http://localhost:3000` → ecoado; `options.trustProxy: 1` → `app.get('trust proxy') === 1`; `GET /shared/pricing.js` 200 `text/javascript` com `max-age=3600`; `GET /` → `no-cache`; varredura de arquivos: nenhum `public/**/*.html` com `<script>` sem `src`, `style="` ou atributo `on[a-z]+=`; nenhum `public/**/*.js` com `innerHTML`/`insertAdjacentHTML`/`outerHTML` fora da linha de guarda de `dom.js`; nenhum arquivo em `public/` contém `SERVICE_ROLE` ou `5585997687641`.
- [ ] Rodar → falha nos headers de cache. Ajustar `express.static(..., { setHeaders })` em `src/app.js`.
- [ ] `npm test` → verde; `grep -rn "\.only\|\.skip" tests` vazio.
- [ ] `docs/DEPLOY.md`: Render/Railway (Node 20, `npm ci`, `npm start`, health check `GET /api/status`), variáveis do spec §16 (com `TRUST_PROXY=1`), aplicar migrations (Tarefa 13), criar usuário admin e desligar signup, `CORS_ORIGIN`/domínio, backups (dump semanal fora do Supabase, 8 semanas, teste de restauração trimestral), pendências do dono (número definitivo pelo painel, fotos, logo/mascote).
- [ ] Verificação manual em produção/staging: checklist "no celular real, 4G" de `barao-testes/SKILL.md` inteiro + Lighthouse mobile ≥ 90 em Performance, Acessibilidade, Boas práticas (registrar as notas no PR).
- [ ] `git add src/app.js tests/integration/security.test.js docs/DEPLOY.md && git commit -m "chore: cabeçalhos de cache, testes de segurança e guia de deploy" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Mapa de paralelização

Regra: tarefas da mesma onda nunca tocam o mesmo arquivo. Arquivos compartilhados têm dono único: `package.json` (T1, ninguém mais), `src/app.js` e `src/routes/admin/index.js` (T7 cria com todos os registros; só T24 volta em `app.js`, sozinha na última onda), stubs de rotas (T7 cria; T8–T12 substituem cada um o seu), `tests/helpers/fakeDb.js` (T3 cria; só T11 altera, única da onda 4 a tocá-lo), `public/js/app.js` + stubs do front (T15 cria; T16–T19 substituem cada um o seu), `public/css/menu.css` (T17 cria na onda 3; T18 acrescenta na onda 4), `public/css/admin.css` e stubs do admin (T20 cria; T21–T23 só substituem o próprio `.js`).

- **Onda 1:** T1
- **Onda 2:** T2, T3, T4, T5, T13, T15
- **Onda 3:** T6, T7, T16, T17, T20
- **Onda 4:** T8, T9, T10, T11, T12, T14, T18, T19, T21, T22, T23
- **Onda 5:** T24

Conferência de arquivos da onda 4: T8 (`menu.routes.js`, `status.routes.js`), T9 (`order.service.js`, `orders.routes.js`), T10 (`admin/hours|settings.routes.js`), T11 (`admin/products.routes.js`, `upload.js`, `fakeDb.js`), T12 (`admin/orders|reports.routes.js`, `dateRange.service.js`), T14 (`src/db/**`, `server.js`), T18 (`product-modal.js`, `menu.css`), T19 (`checkout.js`, `order-payload.js`, `cart.css`), T21–T23 (um `.js` de tela cada) — todos os testes em arquivos próprios. Nenhuma interseção.

## Auto-revisão

1. **Cobertura do spec:** §2/§18 → T1; §3.2 → T1, T2; §4 → T13 (+ `orders_summary`); §5.1/§12 → T7; §5.2 → T8, T9, T7 (`admin-config`); §5.3 → T7; §5.4 → T10–T12; §6 → T2, T6; §7 → T3; §8 → T9; §9 → T4, T9; §10.1 → T15; §10.2 → T16; §10.3 → T18; §10.4–10.5 → T17, T19, T15 (polling); §11 → T20–T23; §13 → T7, T24; §14 → T15, T17, T24; §15 casos 1–37 → T1–T12 (38 → T13 manual); §16 → T14, T24; §17 → T7, T9. Lacunas corrigidas durante a revisão: `orders_summary` ausente do 0001 do spec (incluída na T13); `AdminProduct` exige `categorySlug/createdAt/updatedAt` que o `Product` das skills não tem (T11 + T14); ação "Voltar para recebido" (T23).
2. Nenhum passo sem decisão; corpos de função só apontam para referências, exceto `describeNextOpening`, `resolveLocalDateRange` e os mapeamentos de admin, descritos por contrato + teste.
3. Nomes conferidos com as skills: `getStoreStatus(now, hours, override, timeZone)`, `buildWhatsAppUrl`, `priceOrderItems`, `createOrder(input, { db, now, timeZone })`, `createRepository`, `makeApp`, `IDS`.
4. Cada linha do Review Focus tem teste nomeado na tarefa dona (T16, T12/T23, T9/T5, T19, T20).
5. Proporção: 24 tarefas apontando para referências, sem transcrever código.
6. Dependências de teste entre tarefas da mesma onda removidas: casos dos testes de referência que chamavam rotas de outra tarefa da onda 4 foram redistribuídos (rotas públicas → T8; esgotar produto → T11; número novo no pedido → T9; formatos de pedidos → T12) ou trocados por leitura direta do `fakeDb`.

## Lacunas e ambiguidades do spec (decisões tomadas aqui)

- **Assinaturas divergentes spec × skills:** spec §7 usa `getStoreStatus({ now, hours, override, timeZone })` e §8 `buildWhatsappUrl`; as skills (código testado) usam posicional e `buildWhatsAppUrl`. Plano segue as skills (não são parte do contrato HTTP).
- **Listagem admin de pedidos:** spec §5.4 define campos planos (`customerName`, `paymentMethod`, `addressStreet`…); o domínio `Order` das skills é aninhado. Repositório mantém o aninhado e a rota mapeia (T12).
- **`PUT /api/admin/products/:id`:** spec exige campos obrigatórios; skill usa PUT parcial. Vale o spec (T5).
- **Limites/valores:** `address.number` 10 (skill 20); `changeForCents ≥ 0` (skill `positive`); mensagens = spec §12 (skills têm variações).
- **Loja fechada:** spec §10.5 desabilita "adicionar"; `telas.md` deixava montar. Vale o spec (T17).
- **Revalidação do carrinho:** spec mantém esgotado marcado; `cart.js` de referência removia. Vale o spec (T16). Formato `{ v: 1, items }` do spec substitui `{ lines }`.
- **`api.js`:** spec pede `{ ok, data | error }`; referência lançava `ApiError`. Vale o spec (T15).
- **Link do WhatsApp no erro de carregamento (§10.5):** o número só existe em `settings` (servidor) e não pode ser hardcoded; sem API não há número. Decisão: omitir o link e manter "Tentar de novo" até o dono decidir publicar o número no HTML.
- **Filtros sem datas / `from > to` / 366 dias:** schema das skills exigia datas; regras movidas para `dateRange.service` (T12).
- **Logo e mascote:** arquivos ainda não existem → wordmark em texto e mascote omitido (T15).
- **Surrogates soltos:** spec manda não remover caracteres; `toWellFormed()` só troca surrogate inválido por U+FFFD para evitar `URIError` em `encodeURIComponent` depois do pedido salvo (T5).
- **Turno de 24 h** (`opensAt == closesAt`) é válido no servidor (spec §7), mas o painel trata como erro de digitação (skill admin) — mantido.
