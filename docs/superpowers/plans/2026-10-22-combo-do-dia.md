# Combo do dia — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o dono cadastra no painel um combo com vagas de escolha, que aparece no cardápio só nos dias da semana marcados; o cliente monta, adiciona ao carrinho e pede; o servidor reprecifica e valida.

**Architecture:** tabelas novas `combos`/`combo_slots` (migration 0004) + item de pedido `kind='combo'` com snapshot em `combo_id`/`combo_choices`. Regra de preço pura em `shared/pricing.js` (front e servidor); validação/precificação do combo no `pricing.service`; regras de cadastro (um combo por dia, kinds das vagas) num `combo.service` novo; rotas finas. Front: seção "Promoção do dia" + `combo-modal.js`; painel: aba "Combos".

**Tech Stack:** Node 22 ESM, Express 4, Zod 3, Supabase (Postgres/Storage), vanilla JS, `node:test` + supertest.

**Spec:** `docs/superpowers/specs/2026-10-22-combo-do-dia-design.md` (binding). Também: `CLAUDE.md`, spec do MVP `2026-10-18-cardapio-barao-design.md` (formato da mensagem §WhatsApp).

## Global Constraints
- Dinheiro em centavos inteiros (`*_cents` / `*Cents`); nunca float, `toFixed` ou `parseFloat` de preço.
- Servidor recalcula todo preço a partir do banco; preço/nome vindos do front são ignorados.
- Fuso `America/Fortaleza`; "hoje" = `getLocalParts(now, timeZone).weekday` de `src/services/hours.service.js` (0 = domingo); relógio injetado (`now`) em todo teste.
- Sem códigos de erro novos: `VALIDATION_ERROR` 400, `PRODUCT_UNAVAILABLE` 409, `PRODUCT_HAS_ORDERS` 409, `NOT_FOUND` 404.
- Mensagens exatas: "O {nome} não está disponível hoje." · "Este combo não está mais disponível." · "Já existe um combo na {dia}: {nome}." (dias: domingo, segunda-feira, terça-feira, quarta-feira, quinta-feira, sexta-feira, sábado) · "Combo já tem pedidos; marque como esgotado em vez de excluir".
- Limites: nome 2–60, descrição ≤ 200, `priceCents` > 0, `weekdays` 1–7 valores distintos 0–6, 1–4 vagas, rótulo da vaga 2–40, `productIds` ≥ 1 por vaga.
- Pizza do combo = regras atuais da pizza (1 sabor ou 2 distintos; adicional no máx. 1x; no máx. 1 por `addon_group`), sabores restritos à vaga; adicionais somam; sabor não altera preço.
- Migrations 0001–0003 aplicadas em produção: **não editar**; tudo em `0004_combos.sql`.
- Camadas: rota fina → service → repository; Supabase só em `src/db/`; `fakeDb` com a mesma interface (contrato em `tests/unit/repository.contract.test.js`).
- Front: `el()` de `public/js/dom.js`, nunca `innerHTML`; CSS só com tokens; alvos ≥ `var(--tap-min)`; dialogs com foco preso + Esc; PT-BR.
- TDD (RED antes); commits pequenos em PT-BR, Conventional Commits, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus
1. **Combo esquecido no carrinho até outro dia** → `cart.reconcile` remove a linha (combo ausente do cardápio) com o aviso atual; aba antiga que posta mesmo assim recebe 409 "O {nome} não está disponível hoje." — testes na T8 (reconcile) e T6 (409).
2. **Produto da vaga excluído ou esgotado** → cardápio filtra ids inexistentes; vaga sem nenhum produto disponível → combo servido com `available: false`; no modal, esgotados desabilitados — teste na T7 (menu).
3. **Combo editado no painel com o cliente já tendo a versão antiga no carrinho** (vagas/permitidos mudaram) → reconcile valida contra as vagas atuais e remove; servidor revalida (400) — testes na T8 e T6.
4. **Combo com duas pizzas e borda em cada** → "uma borda por pizza" vale por vaga (não por combo); cada borda aparece logo abaixo da sua pizza na mensagem; preço soma as duas — testes na T6 e T5b.
5. **Virada de meia-noite em Fortaleza** (02:59Z vs 03:00Z) → o combo de "hoje" muda no cardápio e no pedido — testes na T5 e T6.

## Contrato (nomes compartilhados por todas as tarefas)

```text
Combo (JSON camelCase, repo/fakeDb/admin):
  { id, name, description, priceCents, imageUrl, weekdays: number[], available,
    slots: [{ id, position, label, kind: 'pizza'|'drink', productIds: string[] }],   // por position
    createdAt, updatedAt }
ComboInput (admin POST/PUT body, validado por comboInputSchema):
  { name, description = '', priceCents, weekdays: number[], slots: [{ label, kind, productIds }] }
  // position = índice no array
Item de pedido combo (body POST /api/orders):
  { kind: 'combo', comboId, quantity, notes?, slots: [ { kind: 'pizza', flavorIds, addonIds = [] } | { kind: 'drink', productId } ] }
Item precificado (priceOrderItems → draft.items → orders.repo / whatsapp):
  { kind: 'combo', comboId, quantity, description: combo.name,
    choices: [{ label, kind, description, addons: [{ name, priceCents }] }],
    addons: [...todos os adicionais achatados], productIds, flavorNames: null,
    baseUnitCents: combo.priceCents, unitPriceCents, notes, lineTotalCents }
Order lido (toOrder): item combo ganha { comboId, choices } (de combo_id / combo_choices); outros kinds: comboId null, choices null.
GET /api/menu: { categories, combo: PublicCombo | null }
  PublicCombo = { id, name, description, priceCents, imageUrl, available, slots: [{ id, position, label, kind, productIds }] }
Linha do carrinho (localStorage barao:cart:v1):
  { key, kind: 'combo', comboId, slots: [...como no body...], quantity, notes }
  key = `c:${comboId}|` + slots serializados na ordem (pizza: `p:${sorted flavorIds}|a:${sorted addonIds}`, drink: `d:${productId}`) unidos por ';'
productsById no front: app.js também indexa o combo do dia: productsById.set(combo.id, { ...combo, kind: 'combo' }).
```

---

### Task 1: Migration `0004_combos.sql`

**Files:** Create `supabase/migrations/0004_combos.sql`

**Interfaces:** Produces as tabelas/colunas/rpcs abaixo (nomes usados pela T3).

- [ ] **Step 1: Escrever** a migration:
  - `public.combos` e `public.combo_slots` exatamente como spec §2.1/§2.2 (checks de tamanho, `price_cents > 0`, `weekdays`: `cardinality between 1 and 7`, todos entre 0 e 6 e distintos — use uma função `immutable` auxiliar ou `check` com subselect não é permitido em check: crie `public.weekdays_valid(smallint[]) returns boolean immutable`), triggers `set_updated_at()`, `unique (combo_id, position)`, `kind in ('pizza','drink')`, `cardinality(product_ids) >= 1`.
  - RLS on, sem policies; `revoke all ... from anon, authenticated` nas duas tabelas (mesmo padrão da 0003).
  - `order_items`: `alter ... drop constraint order_items_kind_check` (check inline da coluna `kind` na 0001; confirme o nome no PGlite) e recrie aceitando `'combo'`; `add column combo_id uuid references public.combos(id) on delete restrict`, `add column combo_choices jsonb`; índice em `combo_id`; recrie `order_items_kind_shape`: pizza e drink como na 0001 **e** `combo_id is null and combo_choices is null`; combo: `flavor_names is null and combo_id is not null and jsonb_typeof(combo_choices) = 'array'`.
  - `create or replace function public.create_order(payload jsonb)` copiando a versão da **0003** (mesma assinatura, `security definer`, `search_path`, `position` via ordinality, `customer_id`), acrescentando `combo_id` (`(item->>'combo_id')::uuid`) e `combo_choices` (`item->'combo_choices'`, null quando ausente). Mantém revoke/grant da 0003.
  - `public.save_combo(p_id uuid, payload jsonb) returns uuid`: `p_id` null → insert; senão update (retorna null se não existe). Substitui as vagas (delete + insert com `position` = ordinality - 1) na mesma transação. Campos do payload: `name, description, price_cents, weekdays (array), slots: [{label, kind, product_ids}]`. `security definer`, `search_path = public`, execute só para `service_role`.
- [ ] **Step 2: Validar no PGlite** (fora do repo, em `<scratchpad>/sqlcheck/`, que já tem stubs de roles/storage/auth): aplicar 0001→0004; checar: `save_combo` cria e substitui vagas; `create_order` com 1 pizza + 1 drink + 1 combo grava `combo_id`/`combo_choices` e positions 0..2; inserir combo com `combo_choices` null falha (kind_shape); `delete from combos` de combo pedido falha (restrict); weekdays `{}` e `{7}` e `{1,1}` falham.
- [ ] **Step 3: Commit** — `feat: migration 0004 de combos`

### Task 2: Preço do combo em `shared/pricing.js`

**Files:** Modify `shared/pricing.js`; Test `tests/unit/pricing.test.js`

**Interfaces:** Produces `calcComboUnitCents(combo: {priceCents}, addons: [{priceCents}] = []) → number`; `calcItemCents` aceita `{ kind: 'combo', combo: {priceCents}, addons, quantity }`.

- [ ] **Step 1: Testes** — `calcComboUnitCents({priceCents: 3690}, [{priceCents: 450}])` → `4140`; sem addons → `3690`; `calcItemCents({kind:'combo', combo:{priceCents:3690}, addons:[{priceCents:450},{priceCents:999}], quantity:2})` → `(3690+450+999)*2 = 10278`; `priceCents` inválido (`-1`, `1.5`) → `TypeError`; quantity 21 → `RangeError`; `calcOrderSubtotalCents` com pizza + combo soma certo.
- [ ] **Step 2: RED** — `node --test tests/unit/pricing.test.js` falha (`calcComboUnitCents is not a function`).
- [ ] **Step 3: Implementar** (reusa `assertCents`/`assertQuantity`).
- [ ] **Step 4: GREEN** + `npm test`.
- [ ] **Step 5: Commit** — `feat: preço do combo no pricing compartilhado`

### Task 3: Repositório de combos (Supabase + fakeDb)

**Files:** Create `src/db/repositories/combos.repo.js`; Modify `src/db/repositories/index.js`, `mappers.js` (`toCombo`, `toOrder` com `comboId`/`choices`), `orders.repo.js` (grava `combo_id`/`combo_choices`), `tests/helpers/fakeDb.js`, `tests/helpers/testkit.js` (`seedCombo`); Test `tests/unit/combos.repo.test.js`, `tests/unit/fakeDb.combos.test.js`, `tests/unit/repository.contract.test.js`, `tests/unit/mappers.test.js`

**Interfaces:**
- Consumes: nomes da T1 (`combos`, `combo_slots`, `save_combo`, `order_items.combo_id/combo_choices`).
- Produces (db): `getTodayCombo(weekday) → Combo|null` (o primeiro por `created_at` cujo `weekdays` contém o dia; inclui esgotado), `listCombos() → Combo[]` (por `created_at`), `getCombo(id) → Combo|null`, `getCombosByIds(ids) → Combo[]`, `createCombo(input: ComboInput) → Combo`, `updateCombo(id, input) → Combo|null`, `deleteCombo(id) → boolean` (lança `AppError('PRODUCT_HAS_ORDERS', 409, 'Combo já tem pedidos; marque como esgotado em vez de excluir')` se algum `order_items.combo_id = id`), `setComboAvailability(id, available) → Combo|null`, `uploadComboImage(id, {buffer, contentType}) → Combo|null` (bucket `product-images`, path `combos/${id}-${Date.now()}.${ext}`, remove a imagem antiga, como `uploadProductImage`). `createOrder(draft)` grava `combo_id: i.comboId ?? null`, `combo_choices: i.choices ?? null`.
- testkit: `seedCombo(db, overrides?) → Combo` — padrão: "Combo Clássico", 3690, `weekdays: [4]` (quinta), vagas `[{label:'Escolha sua pizza', kind:'pizza', productIds: <ids das clássicas do seed>}, {label:'Escolha o refrigerante', kind:'drink', productIds: <ids das Coca 1L>}]`.

- [ ] **Step 1: Testes** — fakeDb: create/list/get/update substitui vagas; `getTodayCombo(4)` acha, `getTodayCombo(2)` → null; delete de combo pedido → 409 com a mensagem; `getCombosByIds`. Repo Supabase com client mockado (padrão de `customers.repo.test.js`): `createCombo` chama `rpc('save_combo', { p_id: null, payload })` com snake_case; `deleteCombo` conta `order_items` por `combo_id`. Mapper `toCombo` ordena slots por `position`; `toOrder` expõe `comboId`/`choices` (null em pizza). Contrato: fakeDb e repo expõem os mesmos métodos novos.
- [ ] **Step 2: RED** · **Step 3: Implementar** · **Step 4: GREEN** + `npm test`
- [ ] **Step 5: Commits** — (a) `feat: combos no repositório em memória dos testes` (b) `feat: repositório de combos no supabase` (c) `feat: pedido grava combo e escolhas`

### Task 4: Schemas Zod

**Files:** Create `src/schemas/combo.schema.js`; Modify `src/schemas/order.schema.js`; Test `tests/unit/schemas.test.js`

**Interfaces:** Produces `comboInputSchema` (ComboInput, limites das Global Constraints, mensagens PT-BR, `priceCents` inteiro > 0, `weekdays` distintos, slots 1–4, `productIds` uuid distintos ≥ 1), `orderItemSchema` com variante `combo` (`comboId` uuid; `slots` 1–4, cada um discriminado por `kind`: pizza = mesmas regras do item pizza sem `quantity`/`notes`; drink = `productId`; `quantity` 1–20; `notes` ≤ 140 como na pizza).

- [ ] **Step 1: Testes** — combo válido passa; 5 vagas → "No máximo 4 vagas."; weekdays `[]`/`[7]`/`[1,1]` falham com mensagem PT-BR; item combo válido no body do pedido passa; slot pizza com 3 sabores falha; slot sem `kind` falha com mensagem PT-BR ("Item inválido." ou mais específica).
- [ ] **Step 2: RED** · **Step 3: Implementar** (reusar `freeText`/`optionalText`/`uuid` existentes) · **Step 4: GREEN**
- [ ] **Step 5: Commit** — `feat: validação de combo e item combo no pedido`

### Task 5: `combo.service.js` (regras de cadastro e combo de hoje)

**Files:** Create `src/services/combo.service.js`; Test `tests/unit/combo.service.test.js`

**Interfaces:**
- Consumes: db da T3; `getLocalParts` (hours.service).
- Produces: `WEEKDAY_NAMES` (`['domingo', ..., 'sábado']`, com "-feira"); `todayWeekday(now, timeZone) → 0..6`; `async getTodayPublicCombo(db, { now, timeZone, productsById }) → PublicCombo|null` (filtra `productIds` inexistentes em `productsById`; `available` = `combo.available && toda vaga tem ≥ 1 produto disponível`); `async assertComboInput(db, input, { excludeId = null })` → lança `VALIDATION_ERROR` 400 "Já existe um combo na {dia}: {nome}." (`details: [{ path: 'weekdays', message }]`) e "{produto} não pode ser usado nesta vaga." (`path: 'slots.{i}.productIds'`) para id inexistente ou de kind diferente da vaga.

- [ ] **Step 1: Testes** — conflito de dia (outro combo com 4 → erro com "quinta-feira" e nome); editar o próprio combo mantendo o dia passa (`excludeId`); bebida em vaga de pizza → erro; `todayWeekday(new Date('2026-10-23T02:59:00Z'))` = 4 (quinta) e `03:00Z` = 5; `getTodayPublicCombo` com produto excluído some da vaga; vaga só com esgotados → `available: false`.
- [ ] **Step 2: RED** · **Step 3: Implementar** · **Step 4: GREEN**
- [ ] **Step 5: Commit** — `feat: regras do combo do dia`

### Task 5b: Mensagem do WhatsApp com combo

**Files:** Modify `src/services/whatsapp.service.js`; Test `tests/unit/whatsapp.service.test.js`

**Interfaces:** Consumes o item precificado combo (Contrato). Produces linhas exatamente como spec §5.

- [ ] **Step 1: Testes** (strings exatas) — combo quantidade 1 com pizza meio a meio + borda + bebida + obs:
  ```
  1x Combo Clássico — R$ 36,90
     • Pizza meio a meio: Calabresa / Mussarela
     + Borda Recheada com Catupiry — R$ 4,50
     • Coca-Cola 1 Litro
     Obs.: sem cebola
  ```
  quantidade 2 → `2x Combo Clássico — R$ 73,80` e `+ Borda … — R$ 9,00`; duas pizzas com borda cada → cada `+` logo abaixo da sua `•`; soma dos valores do bloco = `lineTotalCents`.
- [ ] **Step 2: RED** · **Step 3: Implementar** (`oneLine` em notes; descrições vêm do snapshot) · **Step 4: GREEN**
- [ ] **Step 5: Commit** — `feat: combo na mensagem do whatsapp`

### Task 6: Precificar e aceitar combo no pedido

**Files:** Modify `src/services/pricing.service.js`, `src/services/order.service.js`; Test `tests/unit/pricing.service.test.js`, `tests/integration/orders.routes.test.js`

**Interfaces:**
- Consumes: T2 (`calcComboUnitCents`, `calcItemCents` combo), T3 (`getCombosByIds`, `seedCombo`), T4 (schema), T5b (mensagem), `getLocalParts` (hours.service).
- Produces: `collectProductIds` inclui produtos dos slots; `collectComboIds(items) → string[]`; `priceOrderItems(items, productsById, { combosById = new Map(), weekday } = {})` → item combo precificado (Contrato). `order.service` busca `db.getCombosByIds(collectComboIds(items))` e passa `weekday = getLocalParts(now, timeZone).weekday`.
- Ordem de checagem por item combo: combo inexistente → 409 "Este combo não está mais disponível."; esgotado ou dia fora → 409 "O {nome} não está disponível hoje."; slots ≠ vagas (quantidade/kind) → 400 `items.{i}.slots`; produto fora de `productIds` da vaga ou sabor repetido → 400 `items.{i}.slots.{j}…`; depois o 409 agregado de produtos esgotados (atual); depois "uma borda por pizza" **por slot**.

- [ ] **Step 1: Testes** — unit: combo válido → `baseUnitCents 3690`, `unitPriceCents` com addons, `choices` com descrição "Pizza meio a meio: Calabresa / Mussarela" e addons da própria pizza, `productIds` com tudo; cada erro da ordem acima; duas bordas em slots diferentes passam, duas na mesma falham. Integração (`postOrder` do testkit, relógio de quinta 22:00 local): 201 e o fakeDb guarda `comboId`/`choices`; mesma requisição com relógio de sexta 03:00Z → 409 com a mensagem; combo esgotado → 409; subtotal = soma recalculada (preço enviado pelo cliente ignorado).
- [ ] **Step 2: RED** · **Step 3: Implementar** · **Step 4: GREEN** + `npm test`
- [ ] **Step 5: Commits** — (a) `feat: precificação do combo no servidor` (b) `feat: pedido aceita combo do dia`

### Task 7: Rotas — cardápio e admin de combos

**Files:** Modify `src/routes/menu.routes.js`, `src/routes/admin/index.js`; Create `src/routes/admin/combos.routes.js`; Test `tests/integration/public.routes.test.js`, `tests/integration/admin.combos.test.js`

**Interfaces:**
- Consumes: T3, T4 (`comboInputSchema`, `availabilitySchema`, `idParamSchema`), T5 (`getTodayPublicCombo`, `assertComboInput`), `imageUpload`/`sniffImageType` (como em products.routes).
- Produces: `GET /api/menu` → `{ categories, combo }`; admin `GET/POST /api/admin/combos`, `PUT/DELETE /api/admin/combos/:id`, `PATCH /:id/availability`, `POST /:id/image` — respostas `{ combos }`, `{ combo }`, 204; 404 "Combo não encontrado.".

- [ ] **Step 1: Testes** — menu: sem combo → `combo: null`; quinta → combo com slots; produto excluído filtrado; vaga só com esgotados → `available: false`; relógio 02:59Z vs 03:00Z. Admin: 401 sem token, 403 cliente; CRUD feliz; dia duplicado → 400 com a mensagem e `details[0].path === 'weekdays'`; PUT mantendo os próprios dias passa; DELETE de combo pedido → 409; availability; upload (mesmos casos de `admin.upload.test.js`: tipo errado 400, 404 antes de subir).
- [ ] **Step 2: RED** · **Step 3: Implementar** (rotas finas) · **Step 4: GREEN** + `npm test`
- [ ] **Step 5: Commits** — (a) `feat: cardápio traz o combo do dia` (b) `feat: rotas do admin para combos`

### Task 8: Front do cliente — seção, janela "Montar combo" e carrinho

**Files:** Create `public/js/combo-modal.js`, `public/css/combo.css`; Modify `public/js/cart.js`, `public/js/menu.js`, `public/js/app.js`, `public/index.html` (dialog `#combo-modal`, css), `public/js/product-modal.js` (só se extrair builder compartilhado); Test `tests/unit/front/cart.test.js`, `tests/unit/front/combo-modal.test.js`

**Interfaces:**
- Consumes: `GET /api/menu` `combo` (Contrato), `calcComboUnitCents`/`calcItemCents` (T2), helpers de `product-modal.js` (`splitAddons`, `secondFlavorOptions`, `readSelection`).
- Produces (puros, testáveis): `comboSelectionComplete(combo, slots) → boolean`; `comboSelectionCents(combo, slots, productsById, quantity = 1) → number`; `describeComboSlots(combo, slots, productsById) → string[]` (mesmas descrições do servidor). `cart`: `lineKey`, `normalize`, `isValid`/`reconcile`, `unitCents`, `lineTotalCents`, `subtotalCents`, `describe`, `toOrderItems` suportam `kind: 'combo'` (combo lido de `productsById.get(comboId)` com `kind === 'combo'`; reconcile remove se o combo sumiu, se as vagas não batem ou se um produto não é mais permitido; mantém esgotado como `unavailable`). `renderMenu(..., { combo, onOpenCombo })` desenha a seção "Promoção do dia" antes das abas. `openComboModal(dialog, combo, { productsById, menu, onAdd })`.

- [ ] **Step 1: Testes** — cart: adiciona combo, chave estável independente da ordem dos sabores, `subtotalCents` com combo + addons × quantidade, `toOrderItems` no formato do body, reconcile remove combo ausente/vaga incompatível/produto não permitido, mantém esgotado; combo-modal puro: completo só com todas as vagas; preço ao vivo; descrições "Pizza Calabresa" / "Pizza meio a meio: A / B".
- [ ] **Step 2: RED** · **Step 3: Implementar** — card com selo "Promoção do dia", borda dourada (token), foto ou placeholder `#ph-pizza`, "Montar combo" / "Esgotado hoje"; modal com uma etapa (`fieldset`) por vaga, sabores só da vaga, segundo sabor só da vaga, adicionais, rádio de bebida, esgotados desabilitados, "Adicionar" desabilitado até completo; linha do carrinho com escolhas em texto menor. Se o montador de pizza for necessário nos dois modais, extrair e exportar de `product-modal.js` em vez de duplicar. `security.test.js` verde.
- [ ] **Step 4: GREEN** + `npm test` · roteiro manual (preview com combo semeado): montar meio a meio com borda, quantidade 2, ver total; mudar relógio/combo some do carrinho.
- [ ] **Step 5: Commits** — (a) `feat: carrinho aceita combo` (b) `feat: janela montar combo` (c) `feat: seção promoção do dia no cardápio`

### Task 9: Painel — aba "Combos" e combo nos pedidos

**Files:** Create `public/admin/js/combos.js`; Modify `public/admin/js/painel.js` (aba), `public/admin/painel.html` se necessário, `public/admin/js/orders.js` (item combo), `public/css/admin.css`; Test `tests/unit/front/admin-combos.test.js`, `tests/unit/front/admin-orders.test.js`

**Interfaces:**
- Consumes: rotas da T7; `adminApi`, `withSaving`, `confirmDialog`, `toast` existentes; máscara de preço de `products.js`.
- Produces (puros): `formatWeekdays([2,4]) → 'Ter · Qui'`; `takenWeekdays(combos, editingId) → Map<number, string>` (dia → nome do outro combo); `comboPayload(fields) → ComboInput` (preço em reais → centavos com `parseBRLToCents`); `todayComboName(combos, now) → string|null` (dia em Fortaleza). `orders.js`: item combo renderiza `• escolha` e `+ adicional` sob a escolha, como a mensagem.

- [ ] **Step 1: Testes** dos puros (inclui `comboPayload` de "36,90" → 3690 e vagas na ordem; `takenWeekdays` ignora o próprio combo; `todayComboName` em 02:59Z/03:00Z).
- [ ] **Step 2: RED** · **Step 3: Implementar** — faixa "Hoje aparece: {nome}" / "Nenhum combo hoje"; lista (foto, nome, preço, dias, Esgotado, Editar, Excluir com `confirmDialog`; 409 mostra a mensagem do servidor); formulário (nome, descrição, preço, 7 caixas Dom–Sáb com dia ocupado desabilitado + nome, vagas 1–4 com rótulo/tipo/produtos permitidos e atalhos "Marcar todas as Clássicas/Especiais/Bebidas", subir/descer/remover, foto via `POST /:id/image` após salvar); erros de `details` no campo.
- [ ] **Step 4: GREEN** + `npm test` · manual: criar, editar, conflito de dia, esgotar, excluir, foto.
- [ ] **Step 5: Commits** — (a) `feat: aba combos no painel` (b) `feat: pedido com combo no painel`

### Task 10: Documentação

**Files:** Modify `docs/DEPLOY.md`, `CLAUDE.md`, `.claude/skills/barao-cardapio-precos/SKILL.md`, `.claude/skills/barao-pedido-whatsapp/SKILL.md`, `.claude/skills/barao-supabase/SKILL.md`, `.claude/skills/barao-painel-admin/SKILL.md`

- [ ] **Step 1: Escrever** — DEPLOY: aplicar `0004_combos.sql` + `notify pgrst, 'reload schema';`; CLAUDE.md: regra de negócio do combo (preço = combo + adicionais, um por dia, dias em Fortaleza, snapshot `combo_choices`), estrutura (arquivos novos), Pendências; skills: preço do combo, formato da mensagem com combo, tabelas/métodos novos, aba Combos. Conferir nomes contra o código.
- [ ] **Step 2: Commit** — `docs: combo do dia`

## Ordem / paralelismo
- Onda 1 (paralelo): T1, T2, T3, T4, T5b.
- Onda 2: T5, T6 (após T2/T3/T4/T5b), T8 (após T2).
- Onda 3: T7 (após T5), T9.
- Onda 4: T10.
