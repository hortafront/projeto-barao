# Conta do cliente — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O cliente cria conta (e-mail + senha, sem confirmação), salva nome, telefone e até 10 endereços, e só finaliza pedido logado, com o checkout pré-preenchido.

**Architecture:** Supabase Auth autentica no navegador (supabase-js via CDN, sessão em `localStorage` `barao-cliente-auth`); todo o resto passa pela API Express: middleware `requireCustomer` valida o Bearer com `db.getUserByAccessToken`, rotas finas `/api/me` chamam `customer.service.js`, que usa os novos métodos do repositório (Supabase real e `fakeDb` com a mesma interface). `POST /api/orders` passa a exigir cliente e grava `customer_id` via `create_order`.

**Tech Stack:** Node 22+, Express 4, Zod 3, `@supabase/supabase-js` v2 (servidor) e `@2.45.4` ESM via jsdelivr (browser), `node:test` + `supertest`, Postgres (Supabase) validado em PGlite fora do repo.

**Spec:** `docs/superpowers/specs/2026-10-21-conta-cliente-design.md` (autoridade; onde for omisso vale `docs/superpowers/specs/2026-10-18-cardapio-barao-design.md` e o `CLAUDE.md`).

## Global Constraints

- Node **22+** (`engines` `>=22`), ESM com extensão `.js` explícita em todo import.
- **Nenhuma dependência nova.** No browser, supabase-js só via `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm` (já liberado no CSP).
- Dinheiro = inteiro em centavos; nada de float. Esta feature não toca preço: o servidor continua recalculando tudo.
- O navegador só fala com o Supabase para autenticar (`signUp`, `signInWithPassword`, `signOut`, `resetPasswordForEmail`, `updateUser`, refresh). Perfil, endereços e pedidos só pela API Express.
- `SUPABASE_SERVICE_ROLE_KEY` só no servidor; acesso ao Supabase só em `src/db/`.
- Front: DOM só com `el()`/`render()` de `public/js/dom.js`; **nunca `innerHTML`**; sem `<script>` inline, sem `style=""`, sem `on*=` no HTML.
- CSS: valores visuais só via variáveis de `public/css/tokens.css`; mobile-first (`min-width`).
- Textos de UI e erros em **PT-BR**; identificadores e nomes de arquivo em inglês.
- Acessibilidade: `<dialog>` com foco preso + Esc (`openDialog`), `aria-live` nos erros, alvos >= 44px, foco visível.
- Zod no servidor é a autoridade (middleware `validate`); front só valida leve. Formato de erro único `{ error: { code, message, details? } }`; **nenhum código novo** (401 `UNAUTHORIZED`, 400 `VALIDATION_ERROR`, 404 `NOT_FOUND`).
- Toda consulta de cliente filtra por `req.customer.id`; `fakeDb.js` e `createRepository` expõem **exatamente** os mesmos métodos (`tests/unit/repository.contract.test.js`).
- Nunca logar nome, telefone, e-mail ou endereço completos.
- TDD: teste → ver falhar → implementar → ver passar. Testes nunca tocam o Supabase real nem dependem do relógio da máquina.
- Commits pequenos (um por mudança lógica), Conventional Commits em PT-BR, cada um terminando com o trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (use `git commit -m "<título>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`).
- Migration nova é `supabase/migrations/0003_clientes.sql`; não editar `0001`/`0002`.

## Review Focus

1. **Sessão expira entre abrir o checkout e tocar em "Enviar"**: o envio deve renovar o token e reenviar uma vez sem o cliente perceber; se a renovação falhar, abre "Entrar" por cima do checkout, sem perder carrinho nem formulário, e nenhum pedido é salvo. → T9 (`withAuth`: refresh+retry; falha chama `onSessionLost` uma vez) e T8 (token inválido → 401, `db.state.orders.length === 0`).
2. **`signUp` deu certo mas o `PUT /api/me` falhou (perfil `null`)**: o pedido não pode virar 500 por causa da FK `orders.customer_id → customers`; o servidor responde 400 "Complete seu perfil antes de fazer o pedido." e o front abre "Complete seu perfil" antes do checkout. → T8 (teste do 400) e T10 (`createLoginGate`: perfil `null` chama `openCompleteProfile` antes da ação).
3. **Carrinho e intenção preservados ao passar pela janela de login**: "Finalizar pedido" sem sessão → entrar/criar conta → o checkout abre uma vez com o carrinho intacto; fechar o login descarta a intenção (não abre checkout depois, num login futuro). → T10 (`createLoginGate`: ação roda 1x após login; login cancelado → ação nunca roda, nem no próximo `run`).
4. **Apagar o endereço padrão ou o último endereço / desmarcar o padrão**: o mais recente restante vira padrão; sem endereços, o próximo criado vira padrão; `PUT` com `isDefault: false` no padrão não deixa o cliente sem padrão. → T2 (fakeDb) e T7 (integração).
5. **E-mail do admin usado também como cliente** (o dono testando o próprio site): `requireCustomer` aceita, `/api/me` 200 e pedido 201; as sessões não se misturam (`barao-cliente-auth` em `localStorage` × `barao-admin-auth` em `sessionStorage`). → T7 (token do admin em `GET /api/me` → 200) e T9 (constante `CUSTOMER_STORAGE_KEY === 'barao-cliente-auth'`).

---

### Task 1: Migration `0003_clientes.sql`

**Files:**
- Create: `supabase/migrations/0003_clientes.sql`
- Create (fora do repo, não commitar): `C:\Users\gustavo\AppData\Local\Temp\claude\c--Users-gustavo-OneDrive-Documentos-projetos-vc-code-projetos-no-ar-projeto-barao\53bf0780-9006-42dd-a00c-7582291f6b00\scratchpad\sqlcheck\check0003.mjs`

**Interfaces:**
- Produces (SQL): tabelas `public.customers(user_id, name, phone, created_at, updated_at)` e `public.customer_addresses(id, user_id, label, street, number, district, reference, is_default, created_at, updated_at)`; coluna `orders.customer_id`; `create_order(payload jsonb)` lendo `payload ->> 'customer_id'`; `set_default_address(p_user_id uuid, p_address_id uuid) returns setof public.customer_addresses` (0 linhas = não é do cliente); `delete_customer_address(p_user_id uuid, p_address_id uuid) returns boolean`.
- **Depende de:** — · **Paralelizável com:** T2, T4, T5, T9

- [ ] **Step 1: Escrever o script de verificação** `check0003.mjs` (copiar o preâmbulo de `run.mjs` da mesma pasta: roles `anon/authenticated/service_role`, schema `storage` + `storage.buckets`; acrescentar `create schema auth; create table auth.users(id uuid primary key);`) aplicando `0001`, `0002`, `0003` e imprimindo `OK`/`FAIL` por caso:
  - `customers` com `phone='123'` → erro `23514`; `name='A'` → `23514`; `label` com 31 chars → `23514`; `street` com 1 char → `23514`.
  - dois endereços `is_default=true` do mesmo `user_id` → `23505`; de usuários diferentes → ok.
  - `create_order` com `customer_id` do cliente → `orders.customer_id` igual; sem a chave → `null`; com uuid sem perfil → `23503`.
  - `set_default_address(u, b)` → só `b` com `is_default`; com `user_id` de outro cliente → 0 linhas e nada muda.
  - `delete_customer_address(u, padrão)` com mais 2 restantes → `true` e o de `created_at` maior vira padrão; id de outro cliente → `false`.
  - `delete from auth.users where id = u` → `customers` e `customer_addresses` de `u` somem; o pedido fica com `customer_id is null`.
- [ ] **Step 2: Rodar e ver falhar** — `node check0003.mjs "<repo>/supabase/migrations"` na pasta `sqlcheck`. Esperado: `APPLY FAIL 0003_clientes.sql` (arquivo não existe).
- [ ] **Step 3: Escrever `0003_clientes.sql`** seguindo o spec §2: checks exatamente como as tabelas do spec (`char_length(name) between 2 and 60`, `phone ~ '^[0-9]{10,11}$'`, `label is null or char_length(label) <= 30`, street 2–120, number 1–10, district 2–60, `reference` <= 120); triggers `set_updated_at()` (padrão de `products_set_updated_at` em `0001`); `create unique index customer_addresses_one_default on public.customer_addresses (user_id) where is_default`; índice `(user_id, created_at desc)`; `alter table orders add column customer_id uuid null references public.customers(user_id) on delete set null` + `orders_customer_id_idx`; `create or replace function public.create_order` = cópia da de `0001` acrescentando `customer_id` com `nullif(payload ->> 'customer_id', '')::uuid` (atualizar o comentário do payload). `set_default_address`: plpgsql, `set search_path = public`, primeiro `update ... set is_default = false where user_id = p_user_id and is_default and exists(alvo do cliente)`, depois `update ... set is_default = true where id = p_address_id and user_id = p_user_id returning *` (dois comandos: índice único parcial não é deferrable). `delete_customer_address`: apaga com `user_id`; se o apagado era padrão, promove `order by created_at desc, id desc limit 1`. RLS habilitado nas 2 tabelas, `revoke all ... from anon, authenticated`; `revoke execute` das 2 funções novas de `public, anon, authenticated` e `grant execute ... to service_role` (padrão das linhas 286–303 de `0001`).
- [ ] **Step 4: Rodar e ver passar** — mesmo comando. Esperado: todos `OK`, nenhum `FAIL`.
- [ ] **Step 5: Commit** — `git add supabase/migrations/0003_clientes.sql` · `git commit -m "feat: migration 0003 com clientes, endereços e customer_id no pedido" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 2: `fakeDb` com clientes e testkit

**Files:**
- Modify: `tests/helpers/fakeDb.js`, `tests/helpers/testkit.js`
- Create: `tests/unit/fakeDb.customers.test.js`

**Interfaces:**
- Produces (interface `db`, todos `async`, devolvem cópias):
  - `getCustomer(userId) → { name, phone } | null`
  - `upsertCustomer(userId, { name, phone }) → { name, phone }`
  - `listAddresses(userId) → Address[]` (padrão primeiro, depois `createdAt` desc)
  - `createAddress(userId, { label, street, number, district, reference, isDefault }) → Address` (lança `Error('fakeDb: ... FK')` sem perfil; `isDefault: true` desmarca os outros)
  - `updateAddress(userId, id, data) → Address | null` (`isDefault: true` vira o único padrão; `false`/ausente não muda o padrão)
  - `deleteAddress(userId, id) → boolean` (era padrão → promove o mais recente restante)
  - `setDefaultAddress(userId, id) → Address | null`
  - `deleteCustomerAccount(userId) → void` (apaga perfil, endereços, entradas de `state.users` com esse id; pedidos ficam `customerId: null`)
  - `createOrder(draft)` aceita `draft.customerId`; lança `Error('fakeDb: customer_id sem perfil (FK)')` se não houver perfil; grava `customerId` no pedido de `state.orders`.
  - `Address = { id, label, street, number, district, reference, isDefault, createdAt, updatedAt }` (`label`/`reference` `null` quando vazios).
  - `createFakeDb({ customers })`: seed `{ [userId]: { name, phone } }`; `state.customers`, `state.addresses`.
  - testkit: `CUSTOMER_A = { token: 'token-cliente-a', id: '00000000-0000-4000-8000-0000000000a1', email: 'joao@cliente.com' }` (perfil `João Silva` / `85999999999`), `CUSTOMER_B` (`'token-cliente-b'`, `…0000000000b1`, `bia@cliente.com`, perfil `Bia Costa` / `85988887777`), `CUSTOMER_NEW` (`'token-cliente-novo'`, `…0000000000c1`, `novo@cliente.com`, **sem perfil**); `makeApp` sempre registra os três em `users` (mesclando com `users` passado) e semeia os perfis de A e B; `bearer(customer = CUSTOMER_A) → { Authorization: 'Bearer <token>' }`; `postOrder(app, body, { customer = CUSTOMER_A } = {})`.
- **Depende de:** — · **Paralelizável com:** T1, T4, T5, T9

- [ ] **Step 1: Teste que falha** `tests/unit/fakeDb.customers.test.js` (relógio fixo `fixedNow(SUNDAY_20H)`, logo `createdAt` empata — o fake desempata por ordem de inserção):
  - `upsertCustomer` cria e depois atualiza; `getCustomer` de outro id → `null`.
  - `createAddress` sem perfil lança; o 1º com `isDefault: false` **não** vira padrão aqui (regra do 1º é do service, T6).
  - dois `createAddress` com `isDefault: true` → só o último padrão; `listAddresses` devolve `[padrão, mais recente, ...]`.
  - `updateAddress(u, idPadrão, { ...dados, isDefault: false })` → continua padrão.
  - `deleteAddress` do padrão com 2 restantes → o inserido por último vira padrão; `deleteAddress` do último → lista vazia; id de outro cliente → `false` e nada muda.
  - `setDefaultAddress(B, idDeA)` → `null` e o padrão de A não muda.
  - `deleteCustomerAccount(u)` → `getCustomer(u) === null`, endereços somem, pedido antigo com `customerId === null`.
  - `createOrder({ ...draft, customerId: semPerfil })` lança.
- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/unit/fakeDb.customers.test.js` → FAIL (`db.upsertCustomer is not a function`).
- [ ] **Step 3: Implementar** em `fakeDb.js` (seção `// ---- clientes`, ids `uuid(700000 + seq)`, campo interno `_seq` para desempate, removido nas cópias) e o bloco de clientes do testkit. Atualizar o cabeçalho de `createFakeDb` (`@param overrides.customers`).
- [ ] **Step 4: Rodar e ver passar** — `node --test tests/unit/fakeDb.customers.test.js` → PASS. (O `repository.contract.test.js` fica vermelho até T3, que está na onda seguinte; o resto de `npm test` deve continuar verde.)
- [ ] **Step 5: Commit** — `git add tests/helpers/fakeDb.js tests/unit/fakeDb.customers.test.js` · `git commit -m "test: clientes e endereços no fakeDb" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`
- [ ] **Step 6: Commit do testkit** — `git add tests/helpers/testkit.js` · `git commit -m "test: clientes A, B e sem perfil no testkit" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 3: Repositório Supabase de clientes

**Files:**
- Create: `src/db/repositories/customers.repo.js`, `tests/unit/customers.repo.test.js`
- Modify: `src/db/repositories/index.js`, `src/db/repositories/orders.repo.js`, `src/db/repositories/mappers.js`

**Interfaces:**
- Consumes: SQL de T1 (tabelas, `set_default_address`, `delete_customer_address`); interface de T2.
- Produces: `createCustomersRepo(supabase)` com os 8 métodos de T2 (mesmas assinaturas e retornos); `toAddress(row) → Address` e `ADDRESS_COLUMNS` em `mappers.js`; `orders.repo.createOrder` envia `customer_id: draft.customerId ?? null` no payload da rpc.
- **Depende de:** T1, T2 · **Paralelizável com:** T6, T10

- [ ] **Step 1: Testes que falham** em `tests/unit/customers.repo.test.js` com um stub encadeável de supabase (grava chamadas `from/select/eq/order/upsert/insert/update/rpc/auth.admin.deleteUser`):
  - `toAddress` converte `is_default`→`isDefault`, `created_at`→`createdAt`.
  - `listAddresses('u')` chama `.eq('user_id','u')` e ordena `is_default desc`, `created_at desc`.
  - `setDefaultAddress('u','a')` chama `rpc('set_default_address', { p_user_id: 'u', p_address_id: 'a' })`; 0 linhas → `null`.
  - `deleteAddress` usa `rpc('delete_customer_address', …)` e devolve o boolean.
  - `deleteCustomerAccount('u')` chama `auth.admin.deleteUser('u')`; erro → `AppError` `INTERNAL` (via `dbError`).
  - `orders.repo.createOrder({ ...draft, customerId: 'u' })` → payload da rpc com `customer_id: 'u'`.
  - O contrato existente (`repository.contract.test.js`) já falha pela diferença de métodos.
- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/unit/customers.repo.test.js tests/unit/repository.contract.test.js` → FAIL.
- [ ] **Step 3: Implementar** `customers.repo.js` no padrão de `orders.repo.js`/`auth.repo.js` (`{ data, error }` → `dbError(op, error)`; `.maybeSingle()` para `null`): `upsertCustomer` com `upsert({ user_id, name, phone }, { onConflict: 'user_id' })`; `createAddress`/`updateAddress` gravam sem `is_default` e, se `isDefault === true`, chamam a rpc `set_default_address` e devolvem a linha dela (assim nunca violam o índice único); `updateAddress` filtra `.eq('id', id).eq('user_id', userId)`. Registrar em `index.js`.
- [ ] **Step 4: Rodar e ver passar** — `npm test` → tudo verde (contrato inclusive).
- [ ] **Step 5: Commits** — (a) `git add src/db/repositories/customers.repo.js src/db/repositories/mappers.js src/db/repositories/index.js tests/unit/customers.repo.test.js` · `git commit -m "feat: repositório Supabase de clientes e endereços" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`; (b) `git add src/db/repositories/orders.repo.js tests/unit/customers.repo.test.js` · `git commit -m "feat: create_order recebe customer_id" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 4: Schemas Zod de perfil e endereço

**Files:**
- Modify: `src/schemas/order.schema.js` (só exportar helpers)
- Create: `src/schemas/customer.schema.js`, `tests/unit/customer.schema.test.js`

**Interfaces:**
- Produces: em `order.schema.js`, `export const freeText`, `export const optionalText`, `export const phoneSchema` (o mesmo transform de `customer.phone`, agora reutilizado nele); em `customer.schema.js`: `profileSchema = z.object({ name, phone })`, `addressInputSchema` = `addressSchema.extend({ label: optionalText(30, 'O apelido deve ter no máximo 30 caracteres.'), isDefault: z.boolean({ message: 'Valor inválido.' }).optional() })`.
- **Depende de:** — · **Paralelizável com:** T1, T2, T5, T9

- [ ] **Step 1: Testes que falham** (`customer.schema.test.js`):
  - `profileSchema.parse({ name: '  Ana  ', phone: '(85) 99999-9999' })` → `{ name: 'Ana', phone: '85999999999' }`.
  - nome `'A'` → mensagem `'Informe seu nome.'`; 61 chars → `'O nome deve ter no máximo 60 caracteres.'`; telefone `'859999999'` → `'Telefone com DDD (10 ou 11 dígitos).'`.
  - endereço: `label` 31 chars → `'O apelido deve ter no máximo 30 caracteres.'`; `label: ''` → `null`; sem `street` → `'Informe a rua.'`; `reference` 121 → `'A referência deve ter no máximo 120 caracteres.'`; `isDefault: 'sim'` → falha; ausente → `undefined`.
  - `tests/unit/schemas.test.js` continua verde (refactor do telefone sem mudança de comportamento).
- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/unit/customer.schema.test.js` → FAIL (módulo não existe).
- [ ] **Step 3: Implementar** os exports e `customer.schema.js` reaproveitando `freeText`/`addressSchema` (sem duplicar limites).
- [ ] **Step 4: Rodar e ver passar** — `node --test tests/unit/customer.schema.test.js tests/unit/schemas.test.js` → PASS.
- [ ] **Step 5: Commits** — (a) `git add src/schemas/order.schema.js` · `git commit -m "refactor: exporta freeText, optionalText e phoneSchema" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`; (b) `git add src/schemas/customer.schema.js tests/unit/customer.schema.test.js` · `git commit -m "feat: schemas de perfil e endereço do cliente" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 5: Middleware `requireCustomer`

**Files:**
- Create: `src/middleware/requireCustomer.js`, `tests/unit/requireCustomer.test.js`

**Interfaces:**
- Consumes: `db.getUserByAccessToken(token) → { id, email } | null` (existente).
- Produces: `requireCustomer({ db }) → (req, res, next)`; põe `req.customer = { id, email }`.
- **Depende de:** — · **Paralelizável com:** T1, T2, T4, T9

- [ ] **Step 1: Testes que falham** (chamando o middleware com `req.get` fake e `next` espião):
  - sem header / `Basic x` / token desconhecido → `next(err)` com `err.code === 'UNAUTHORIZED'`, `status 401`, `message === 'Entre na sua conta para continuar.'`.
  - token válido → `next()` sem argumento e `req.customer` deep-equal `{ id, email }`.
  - `getUserByAccessToken` lançando (Supabase fora) → `next(err)` com o mesmo erro (vira 500 no `errorHandler`, não 401).
- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/unit/requireCustomer.test.js` → FAIL.
- [ ] **Step 3: Implementar** no molde de `requireAdmin.js` (mesmo regex `^Bearer\s+(\S+)$`), sem checar e-mail.
- [ ] **Step 4: Rodar e ver passar** — mesmo comando → PASS.
- [ ] **Step 5: Commit** — `git add src/middleware/requireCustomer.js tests/unit/requireCustomer.test.js` · `git commit -m "feat: middleware requireCustomer" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 6: `customer.service.js`

**Files:**
- Create: `src/services/customer.service.js`, `tests/unit/customer.service.test.js`

**Interfaces:**
- Consumes: métodos de T2.
- Produces (todas `async`, primeiro argumento `db`):
  - `getAccount(db, { id, email }) → { email, profile: { name, phone } | null, addresses: Address[] }`
  - `saveProfile(db, userId, { name, phone }) → { name, phone }`
  - `addAddress(db, userId, data) → Address`
  - `editAddress(db, userId, id, data) → Address`
  - `removeAddress(db, userId, id) → void`
  - `makeDefaultAddress(db, userId, id) → Address`
  - `deleteAccount(db, userId) → void`
  - `export const MAX_ADDRESSES = 10`
- **Depende de:** T2 · **Paralelizável com:** T3, T10

- [ ] **Step 1: Testes que falham** (com `createFakeDb({ customers: { u: perfil } })`):
  - `getAccount` sem perfil → `{ email, profile: null, addresses: [] }`.
  - `addAddress` sem perfil → `AppError` `VALIDATION_ERROR` 400, mensagem `'Complete seu perfil antes de salvar endereços.'`.
  - 1º endereço com `isDefault` ausente/false → `isDefault: true`; 2º com `isDefault: false` → `false`.
  - 11º → 400 `'Você pode salvar até 10 endereços.'` e `listAddresses` continua com 10.
  - `editAddress`/`removeAddress`/`makeDefaultAddress` com id de outro cliente ou inexistente → `AppError` `NOT_FOUND` 404 `'Endereço não encontrado.'`.
  - `removeAddress` do único endereço e depois `addAddress` → o novo é padrão (Review Focus 4).
- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/unit/customer.service.test.js` → FAIL.
- [ ] **Step 3: Implementar**: `addAddress` lê `getCustomer` e `listAddresses` para as regras; passa `isDefault: data.isDefault === true || count === 0`; `edit/remove/makeDefault` traduzem `null`/`false` do repo em 404.
- [ ] **Step 4: Rodar e ver passar** — mesmo comando → PASS.
- [ ] **Step 5: Commit** — `git add src/services/customer.service.js tests/unit/customer.service.test.js` · `git commit -m "feat: regras de perfil e endereços do cliente" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 7: Rotas `/api/me`

**Files:**
- Create: `src/routes/me.routes.js`, `tests/integration/me.routes.test.js`
- Modify: `src/app.js` (montagem + comentário do CSP), `src/middleware/rateLimit.js`

**Interfaces:**
- Consumes: `requireCustomer` (T5), schemas (T4), service (T6), `idParamSchema` de `order.schema.js`.
- Produces: `meRoutes({ db, options }) → Router`; `accountRateLimit({ enabled })` (300 req / 15 min, mesmo formato de `adminRateLimit`); em `app.js`: `app.use('/api/me', accountRateLimit({ enabled: opts.rateLimit }), requireCustomer({ db }), meRoutes({ db, options: opts }))`, antes do 404 de `/api`.
- Rotas: `GET /` → `getAccount`; `PUT /` → `{ profile }`; `POST /addresses` → 201 `{ address }`; `PUT /addresses/:id` → `{ address }`; `DELETE /addresses/:id` → 204; `PATCH /addresses/:id/default` → `{ address }`; `DELETE /` → 204.
- **Depende de:** T4, T5, T6 · **Paralelizável com:** T8, T11, T13

- [ ] **Step 1: Testes que falham** (`makeApp()` + `bearer()` do testkit):
  - cada uma das 7 rotas sem token → 401 `UNAUTHORIZED` `'Entre na sua conta para continuar.'`.
  - `GET /api/me` (A) → `email: 'joao@cliente.com'`, `profile: { name: 'João Silva', phone: '85999999999' }`, `addresses: []`; (`CUSTOMER_NEW`) → `profile: null`.
  - `PUT /api/me` (`CUSTOMER_NEW`, telefone `'(85) 98888-7777'`) → 200 `{ profile: { …, phone: '85988887777' } }`; nome `'A'` → 400 `VALIDATION_ERROR`.
  - CRUD: `POST` → 201 com `isDefault: true`; `PUT` altera; `PATCH …/default` deixa **um** padrão; `DELETE` do padrão → 204 e o mais recente restante vira padrão; `GET` lista padrão primeiro.
  - `PUT /api/me/addresses/:idPadrão` com `isDefault: false` → continua padrão.
  - 11º → 400 `'Você pode salvar até 10 endereços.'`; `CUSTOMER_NEW` → 400 `'Complete seu perfil antes de salvar endereços.'`.
  - Cliente B com id de endereço de A em `PUT`, `DELETE`, `PATCH` → 404 `NOT_FOUND`, e o endereço de A segue igual; id malformado → 400.
  - `DELETE /api/me` (A, com pedido criado via `db.createOrder({ …, customerId: A.id })`) → 204; depois `GET /api/me` com o token de A → 401; `db.state.orders[0].customerId === null`.
  - Review Focus 5: `makeApp({ users: { 'token-dono': { id: '…0000000000d1', email: 'dono@barao.com' } } })` → `GET /api/me` → 200 com `profile: null` (e-mail de `ADMIN_EMAILS` também é cliente).
  - Resposta de erro nunca tem `stack`.
- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/integration/me.routes.test.js` → FAIL (404 nas rotas).
- [ ] **Step 3: Implementar** `me.routes.js` no molde de `src/routes/admin/products.routes.js` (`validate(idParamSchema, 'params')`, `asyncHandler`, service com `req.customer.id`), `accountRateLimit` e a montagem em `app.js`; trocar o comentário de `script-src` para "supabase-js ESM (login do admin e do cliente)".
- [ ] **Step 4: Rodar e ver passar** — `npm test` → verde.
- [ ] **Step 5: Commits** — (a) `git add src/middleware/rateLimit.js` · `git commit -m "feat: rate limit das rotas da conta do cliente" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`; (b) `git add src/routes/me.routes.js src/app.js tests/integration/me.routes.test.js` · `git commit -m "feat: rotas /api/me de perfil e endereços" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 8: `POST /api/orders` exige cliente

**Files:**
- Modify: `src/routes/orders.routes.js`, `src/services/order.service.js`, `tests/integration/orders.routes.test.js`, `tests/integration/whatsapp.message.test.js`, `tests/integration/app.test.js`

**Interfaces:**
- Consumes: `requireCustomer` (T5), `db.getCustomer` e `createOrder` com `customerId` (T2/T3), `postOrder`/`bearer` (T2).
- Produces: `createOrder(input, { db, now, timeZone, customerId })` — `customerId` obrigatório; `draft.customerId`. Pipeline da rota: `ordersRateLimit` → `requireCustomer({ db })` → `validate(createOrderSchema)` (rate limit antes do auth: chuva sem token também conta).
- **Depende de:** T2, T3, T5 · **Paralelizável com:** T7, T11, T13

- [ ] **Step 1: Testes que falham** em `orders.routes.test.js`:
  - sem token → 401 `UNAUTHORIZED` e `db.state.orders.length === 0`; token desconhecido (sessão expirada, Review Focus 1) → 401 e nada salvo.
  - com A → 201 e `db.state.orders[0].customerId === CUSTOMER_A.id`; nome/telefone do pedido continuam os do body (snapshot), não os do perfil.
  - `CUSTOMER_NEW` (sem perfil, Review Focus 2) → 400 `VALIDATION_ERROR` `'Complete seu perfil antes de fazer o pedido.'`, `details[0].path === 'profile'`, nada salvo.
  - loja fechada + A → continua 409 `STORE_CLOSED` (a checagem de loja vem antes da de perfil).
- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/integration/orders.routes.test.js` → FAIL (201 sem token).
- [ ] **Step 3: Implementar** a rota e o service (perfil ausente → `AppError('VALIDATION_ERROR', 400, msg, [{ path: 'profile', message: msg }])` logo após o teste de loja). Trocar todos os `request(app).post('/api/orders')` dos testes existentes por `postOrder(...)` / `.set(bearer())` (`orders.routes`, `whatsapp.message`, `app.test` — o teste de JSON malformado também precisa do header, senão vira 401 antes do 400).
- [ ] **Step 4: Rodar e ver passar** — `npm test` → verde.
- [ ] **Step 5: Commit** — `git add src/routes/orders.routes.js src/services/order.service.js tests/integration/orders.routes.test.js tests/integration/whatsapp.message.test.js tests/integration/app.test.js` (rota, service e testes juntos: a suíte só fica verde assim) · `git commit -m "feat: pedido exige cliente logado e grava customer_id" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 9: Sessão do cliente no front (`api.js`, `customer-api.js`, `auth.js`)

**Files:**
- Modify: `public/js/api.js`, `tests/unit/front/api.test.js`
- Create: `public/js/customer-api.js`, `tests/unit/front/customer-api.test.js`, `public/js/auth.js`

**Interfaces:**
- Produces:
  - `api.js`: `request(path, { method, body, timeoutMs, cache, token })` (com `token` → header `Authorization: Bearer <token>`); `createOrder(payload, { token } = {})`.
  - `customer-api.js` (puro, sem CDN/DOM): `createCustomerApi({ request, getAccessToken, refreshSession, onSessionLost }) → { withAuth(call: (token) => Promise<Result>), customerApi(path, opts) }` onde `Result` é o formato de `request` (`{ ok, status, data } | { ok: false, error }`); `authErrorMessage(error) → string`; `passwordError(password, confirm?) → string | null`; `export const CUSTOMER_STORAGE_KEY = 'barao-cliente-auth'`; `export const SESSION_LOST = { status: 401, code: 'UNAUTHORIZED', message: 'Entre na sua conta para continuar.' }`.
  - `auth.js` (wrapper do CDN, não testado em Node): `getSession()`, `signUp({ name, phone, email, password }) → { profileSaved: boolean }`, `signIn({ email, password })`, `signOut({ scope } = {})`, `requestPasswordReset(email)`, `updatePassword(newPassword)`, `onAuthChange(fn)`, `customerApi(path, opts)`, `withAuth(call)`, `onSessionLost(fn)`.
- **Depende de:** — · **Paralelizável com:** T1, T2, T4, T5

- [ ] **Step 1: Testes que falham**
  - `api.test.js`: `request('/api/me', { token: 't1' })` envia `Authorization: 'Bearer t1'`; sem token não envia `Authorization`; `createOrder(p, { token: 't' })` envia o header.
  - `customer-api.test.js` (fakes injetados, no estilo de `admin-api.test.js`):
    - sem token → não chama `request`, chama `onSessionLost` 1x e devolve `{ ok: false, error: SESSION_LOST }`.
    - 401 → `refreshSession` → repete **uma** vez com o token novo → resultado do retry (Review Focus 1).
    - refresh `false`/rejeitado ou 401 de novo → `onSessionLost` 1x; nunca mais de 2 chamadas a `request`.
    - 400/409/`NETWORK` passam direto, sem refresh.
    - `authErrorMessage`: `{ code: 'invalid_credentials' }` → `'E-mail ou senha incorretos.'`; `{ code: 'user_already_exists' }` e mensagem `/already registered/i` → `'Já existe uma conta com esse e-mail. Quer entrar?'`; `{ code: 'weak_password' }` → `'A senha precisa ter pelo menos 8 caracteres.'`; `{ name: 'AuthRetryableFetchError' }`/`status: 0` → `'Sem conexão. Verifique sua internet e tente de novo.'`; `status: 429` → `'Muitas tentativas. Aguarde alguns minutos e tente de novo.'`; outro → `'Algo deu errado. Tente novamente.'`.
    - `passwordError('1234567')` → `'A senha precisa ter pelo menos 8 caracteres.'`; `passwordError('12345678', 'x')` → `'As senhas não conferem.'`; válido → `null`.
    - `CUSTOMER_STORAGE_KEY === 'barao-cliente-auth'` (≠ `'barao-admin-auth'`, Review Focus 5).
- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/unit/front/api.test.js tests/unit/front/customer-api.test.js` → FAIL.
- [ ] **Step 3: Implementar** `api.js` e `customer-api.js`; depois `auth.js` no molde de `public/admin/js/auth.js` com estas diferenças: o CDN é carregado com **`import()` dinâmico** dentro de `getSupabase()` (não pesa no primeiro paint/Lighthouse); `storage: window.localStorage`, `storageKey: CUSTOMER_STORAGE_KEY`; `detectSessionInUrl: location.pathname.startsWith('/conta/nova-senha')`. `signUp`: `passwordError` antes; `supabase.auth.signUp({ email, password })`; sem `data.session` → lança `'Não foi possível entrar automaticamente. Tente entrar com seu e-mail e senha.'`; depois `customerApi('/api/me', { method: 'PUT', body: { name, phone } })` e devolve `{ profileSaved: res.ok }` (falha do PUT não desfaz o cadastro). Erros do Supabase saem como `Error(authErrorMessage(err))`. `requestPasswordReset` usa `redirectTo: \`${location.origin}/conta/nova-senha.html\``. `signOut({ scope: 'local' })` é o usado após excluir a conta.
- [ ] **Step 4: Rodar e ver passar** — mesmo comando → PASS; `npm test` verde.
- [ ] **Step 5: Commits** — (a) `git add public/js/api.js tests/unit/front/api.test.js` · `git commit -m "feat: api.js envia Bearer quando há sessão" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`; (b) `git add public/js/customer-api.js tests/unit/front/customer-api.test.js` · `git commit -m "feat: customerApi com refresh e mensagens de login" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`; (c) `git add public/js/auth.js` · `git commit -m "feat: sessão do cliente com supabase-js" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 10: Janela "Entrar / Criar conta", botão no header e login gate

**Files:**
- Create: `public/js/login-gate.js`, `tests/unit/front/login-gate.test.js`, `public/js/auth-dialog.js`, `public/css/account.css`
- Modify: `public/index.html`, `public/js/app.js`

**Interfaces:**
- Consumes: `auth.js` e `customer-api.js` (T9), `maskPhone`/`onlyDigits` de `order-payload.js`, `openDialog`/`el`/`render`/`announce` de `dom.js`.
- Produces:
  - `createLoginGate({ getSession, loadMe, openLogin, openCompleteProfile }) → { run(action: (me) => any): Promise<boolean> }` — `openLogin() → Promise<boolean>` (true = entrou), `loadMe() → Promise<Me | null>`, `openCompleteProfile(me) → Promise<Me | null>`; `needsProfile(me) → boolean`.
  - `auth-dialog.js`: `initAuthDialog({ dialog, auth, toast }) → { openLogin(tab = 'login'): Promise<boolean>, openCompleteProfile(me): Promise<Me | null>, loadMe(): Promise<Me | null> }`.
  - `index.html`: `<button type="button" id="account-button" class="header-account">Entrar</button>` antes de `#store-status` (o header vira grupo à direita); `<dialog id="auth-modal" class="modal" aria-labelledby="auth-title">` e `<dialog id="account-modal" class="modal modal--full" aria-labelledby="account-title">` (vazio, preenchido em T12); `<link rel="stylesheet" href="/css/account.css">`.
  - `app.js`: instancia `auth-dialog` e `gate`; header: "Entrar" ↔ "Minha conta" via `onAuthChange`; expõe para T11/T12 um objeto `account = { gate, withAuth, customerApi, openLogin, openCompleteProfile, loadMe }` (passado a `initCheckout` em T11 e a `initAccount` em T12). Até T12, "Minha conta" abre `gate.run(() => {})`.
- **Depende de:** T9 · **Paralelizável com:** T3, T6

- [ ] **Step 1: Testes que falham** (`login-gate.test.js`, fakes):
  - com sessão e perfil → ação chamada 1x com `me`; `openLogin` não chamado.
  - sem sessão, `openLogin` → `true` → `loadMe` → ação 1x (Review Focus 3).
  - sem sessão, `openLogin` → `false` → ação não roda e `run` resolve `false`; num `run` seguinte com outra ação, só a nova roda (a antiga não "vaza").
  - `profile: null` → `openCompleteProfile` antes; devolve `me` atualizado → ação com o novo `me`; devolve `null` → ação não roda (Review Focus 2).
  - `loadMe` → `null` (rede) → ação não roda; `run` resolve `false`.
  - dois `run` simultâneos → `openLogin` chamado 1x (a segunda chamada reaproveita a promessa pendente).
- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/unit/front/login-gate.test.js` → FAIL.
- [ ] **Step 3: Implementar** `login-gate.js`; depois `auth-dialog.js`: abas "Entrar" / "Criar conta" (`role="tablist"`, setas trocam aba), campos com `<label>`, telefone com `maskPhone`, erros num `<p class="field-error" aria-live="polite">`, botão desabilitado + "Entrando…" durante a chamada (evita duplo cadastro), "Esqueci minha senha" → pede e-mail e chama `requestPasswordReset`, sempre mostrando "Se houver uma conta com esse e-mail, enviamos um link para criar uma nova senha." (não revela se o e-mail existe). "Já existe uma conta…" troca para a aba Entrar com o e-mail preenchido. `openCompleteProfile`: formulário "Complete seu perfil" (nome, telefone) → `PUT /api/me` → resolve com `loadMe()`. Fechar (Esc/×/backdrop) resolve `false`/`null`. `account.css`: header-account (alvo ≥ 44px), abas, formulário — só tokens. `index.html` e `app.js` conforme Interfaces.
- [ ] **Step 4: Rodar e ver passar** — `npm test` → verde (inclui a varredura de HTML/`innerHTML` do `security.test.js`).
- [ ] **Step 5: Commits** — (a) `login-gate.js` + teste · `feat: login gate que retoma a ação após entrar`; (b) `auth-dialog.js` · `feat: janela entrar e criar conta`; (c) `account.css` + `index.html` · `feat: botão Entrar no header e estilos da conta`; (d) `app.js` · `feat: liga sessão do cliente ao cardápio` (todos com `-m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`).

### Task 11: Checkout com sessão e endereços salvos

**Files:**
- Modify: `public/js/order-payload.js`, `tests/unit/front/order-payload.test.js`, `public/js/checkout.js`, `public/js/app.js`, `public/css/cart.css`

**Interfaces:**
- Consumes: `account` de T10 (`gate.run`, `withAuth`, `customerApi`, `openLogin`, `openCompleteProfile`); `createOrder(payload, { token })` (T9).
- Produces (puros, em `order-payload.js`):
  - `NEW_ADDRESS = 'new'`
  - `defaultAddressChoice(addresses) → string` (id do padrão; sem endereços → `'new'`)
  - `applyAddressChoice(fields, addresses) → fields` — `fields.addressChoice` = id salvo → copia `street/number/district/reference` dele (ignora o que estiver nos inputs); `'new'` ou ausente → mantém os inputs; id desconhecido → `FieldError('addressChoice', 'Escolha um endereço.')`; retirada → devolve `fields` sem mexer.
  - `addressToSave(fields) → { street, number, district, reference } | null` (só quando `fulfillment === 'delivery'`, `addressChoice === 'new'` e `fields.saveAddress === 'on'`).
  - `prefillFromMe(me) → { name, phone }` (telefone com `maskPhone`).
  - `addressLabel(address) → string` (`'Casa — Rua X, 123'`; sem label → `'Rua X, 123 — Bairro Y'`), usado também em T12.
  - `initCheckout({ ..., account })`.
- **Depende de:** T9, T10 · **Paralelizável com:** T7, T8, T13

- [ ] **Step 1: Testes que falham** (`order-payload.test.js`):
  - `defaultAddressChoice([{ id: 'a', isDefault: false }, { id: 'b', isDefault: true }]) === 'b'`; `([]) === 'new'`.
  - `buildOrderPayload(applyAddressChoice({ …, fulfillment: 'delivery', addressChoice: 'b', street: 'lixo' }, addrs), items, 0).address` deep-equal ao endereço `b` (sem `id`, `label`, `isDefault`).
  - `addressChoice: 'zzz'` → `FieldError` com `field === 'addressChoice'`.
  - `'new'` mantém os inputs; retirada ignora a escolha e o body não tem `address`.
  - `addressToSave` → objeto só com `'new'` + `saveAddress: 'on'` + entrega; nos demais casos `null`.
  - `prefillFromMe({ profile: { name: 'Ana', phone: '85999999999' } })` → `{ name: 'Ana', phone: '(85) 99999-9999' }`.
  - `addressLabel({ label: 'Casa', street: 'Rua X', number: '123', district: 'Bairro Y' }) === 'Casa — Rua X, 123'`; com `label: null` → `'Rua X, 123 — Bairro Y'`.
- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/unit/front/order-payload.test.js` → FAIL.
- [ ] **Step 3: Implementar** os helpers; em `checkout.js`: "Finalizar pedido" passa a fazer `afterDrawerClose = () => account.gate.run((me) => openCheckout(me))` (o carrinho não é tocado no caminho); `paintCheckout(me)` preenche nome/telefone com `prefillFromMe` (editáveis só neste pedido); fieldset de rádios `addressChoice` com os salvos (`addressLabel`, padrão marcado) + "Usar outro endereço" que mostra o `addressBox` atual com a caixa "Salvar este endereço"; tudo oculto na retirada. Submit: `buildOrderPayload(applyAddressChoice(fields, me.addresses), …)`; o submitter usa `createOrder: (p) => account.withAuth((token) => createOrder(p, { token }))`. Após `onCreated`, se `addressToSave(fields)` → `account.customerApi('/api/me/addresses', { method: 'POST', body })` sem `await` no fluxo de confirmação e sem mensagem de erro bloqueante (falha não afeta o pedido). `handleFailure`: `UNAUTHORIZED` → diz "Sua sessão expirou. Entre de novo e toque em Enviar." e chama `account.openLogin()` com o checkout aberto (form preservado); `VALIDATION_ERROR` com `details` em `profile` → `account.openCompleteProfile()`. Adicionar `'addressChoice'` em `FIELD_ORDER`. `app.js` passa `account` a `initCheckout`. `cart.css`: lista de endereços salvos (rádios com alvo ≥ 44px).
- [ ] **Step 4: Rodar e ver passar** — `npm test` → verde.
- [ ] **Step 5: Commits** — (a) `order-payload.js` + teste · `feat: escolha de endereço salvo no pedido`; (b) `checkout.js` + `app.js` + `cart.css` · `feat: checkout exige login e usa perfil e endereços salvos`.

### Task 12: Janela "Minha conta"

**Files:**
- Create: `public/js/account.js`
- Modify: `public/js/app.js`, `public/css/account.css`

**Interfaces:**
- Consumes: `account` de T10 (`gate`, `customerApi`), `auth.signOut` (T9), `#account-modal` (T10), `addressLabel` (T11).
- Produces: `initAccount({ dialog, account, auth, toast }) → { open(): void }` (abre via `account.gate.run`, logo perfil incompleto passa antes por "Complete seu perfil").
- **Depende de:** T10, T11 (só pelo `app.js`) · **Paralelizável com:** T14

- [ ] **Step 1: Sem lógica pura nova** — regras ficam no servidor (T6/T7), o gate em T10 e `addressLabel` em T11; a cobertura automática desta task é a varredura de `security.test.js`. Escrever primeiro o roteiro manual do Step 4.
- [ ] **Step 2: Rodar** — `npm test` (verde antes de começar).
- [ ] **Step 3: Implementar** `account.js`: seção perfil (nome, telefone com máscara, Salvar → `PUT /api/me`, erros de `details` no campo); lista de endereços (`addressLabel`, selo "Padrão", botões Editar, Apagar com `confirm` nativo em `<dialog>` próprio, "Tornar padrão" → `PATCH`); "Adicionar endereço" (desabilitado com aviso ao chegar em 10); botão **Sair** → `auth.signOut()` e fecha; **Excluir minha conta** → confirmação com o texto exato "Isso apaga seus dados e endereços. Seus pedidos anteriores continuam registrados na pizzaria." → `DELETE /api/me` → `auth.signOut({ scope: 'local' })` → fecha e toast "Conta excluída.". Após cada mutação, recarrega com `GET /api/me` e re-renderiza (o servidor decide quem é padrão). `app.js`: `#account-button` logado → `accountUi.open()`. `account.css`: lista e ações.
- [ ] **Step 4: Verificar** — `npm test` verde; manual com `npm run dev`: criar conta, adicionar 2 endereços, apagar o padrão (o outro vira padrão), "Tornar padrão", sair/entrar, excluir conta (header volta a "Entrar").
- [ ] **Step 5: Commits** — (a) `account.js` + `account.css` · `feat: janela minha conta com perfil e endereços`; (b) `app.js` · `feat: botão minha conta abre a janela da conta`.

### Task 13: Página "Nova senha"

**Files:**
- Create: `public/conta/nova-senha.html`, `public/js/nova-senha.js`
- Modify: `tests/integration/security.test.js`

**Interfaces:**
- Consumes: `auth.js` (`onAuthChange`, `getSession`, `updatePassword`), `passwordError` (T9).
- Produces: página servida em `/conta/nova-senha.html` (Redirect URL do Supabase).
- **Depende de:** T9 · **Paralelizável com:** T7, T8, T11

- [ ] **Step 1: Testes que falham** em `security.test.js`: incluir `'/conta/nova-senha.html'` na lista de páginas com `200` + `Cache-Control: no-cache`; `htmls.length >= 4`.
- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/integration/security.test.js` → FAIL (404).
- [ ] **Step 3: Implementar** o HTML (`lang="pt-BR"`, mesmas fontes/CSS de `index.html` + `account.css`, `<script type="module" src="/js/nova-senha.js">`, `<main>` com `aria-live`) e o módulo: espera sessão de recuperação (`onAuthChange` com `PASSWORD_RECOVERY` ou `getSession()`), sem sessão → "Link inválido ou expirado. Peça um novo em Entrar → Esqueci minha senha." + link "Voltar ao cardápio" (`/`); com sessão → nova senha + confirmação (`passwordError`) → `updatePassword` → `location.assign('/')` (continua logado).
- [ ] **Step 4: Rodar e ver passar** — `npm test` → verde.
- [ ] **Step 5: Commit** — `git add public/conta/nova-senha.html public/js/nova-senha.js tests/integration/security.test.js` · `git commit -m "feat: página para criar nova senha" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 14: Documentação

**Files:**
- Modify: `docs/DEPLOY.md`, `CLAUDE.md`, `docs/BRIEFING.md`, `.claude/skills/barao-supabase/SKILL.md`

**Interfaces:**
- **Depende de:** T1–T13 (descreve o que existe) · **Paralelizável com:** T12

- [ ] **Step 1: Escrever** — `DEPLOY.md`: migrations `0001`→`0002`→`0003`; seção 3 reescrita: signup público **ligado** (admin protegido por `ADMIN_EMAILS`), "Confirm email" **desligado**, senha mínima **8** em Auth → Providers → Email, SMTP (Resend) configurado, Site URL `https://<domínio>` e Redirect URL `https://<domínio>/conta/nova-senha.html`; aviso "sem SMTP, Esqueci minha senha não funciona"; checklist manual do spec §6 (criar conta, pedir, sair/entrar, esqueci a senha com e-mail real, excluir conta). `CLAUDE.md`: link do spec da conta; regra inegociável nova "**Login obrigatório para finalizar o pedido** (`POST /api/orders` com `requireCustomer`, grava `customer_id`); carrinho continua livre"; estrutura (`auth.js`, `customer-api.js`, `login-gate.js`, `auth-dialog.js`, `account.js`, `conta/nova-senha.html`, `me.routes.js`, `customer.service.js`, `customers.repo.js`, `0003_clientes.sql`); `SUPABASE_ANON_KEY` também usada no login do cliente. `BRIEFING.md` §9: tirar "Login/cadastro de cliente" de "Fora do MVP" e registrar que histórico do cliente segue fora. Skill `barao-supabase`: os 8 métodos novos na tabela "Interface do repositório".
- [ ] **Step 2: Verificar** — `npm test` → verde; reler cada valor contra o spec.
- [ ] **Step 3: Commits** — (a) `DEPLOY.md` · `docs: deploy com cadastro de cliente e recuperação de senha`; (b) `CLAUDE.md` + `BRIEFING.md` · `docs: login obrigatório para pedir e escopo da conta`; (c) skill · `docs: interface do repositório com clientes`.

---

## Mapa de paralelização

Donos únicos de arquivos compartilhados: `src/app.js` → T7; `tests/helpers/fakeDb.js` e `testkit.js` → T2; `public/index.html` → T10; `public/js/api.js` → T9; `public/js/checkout.js` e `order-payload.js` → T11; `public/js/app.js` → T10, T11, T12 em ondas diferentes; `public/css/account.css` → T10, depois T12; `tests/integration/security.test.js` → T13.

| Onda | Tarefas | Arquivos (sem interseção dentro da onda) |
|---|---|---|
| 1 | T1, T2+T3, T4, T5, T9 | migration · fakeDb/testkit + repositories/* (uma tarefa só) · schemas · requireCustomer · api.js/customer-api.js/auth.js |
| 2 | T6, T10 | customer.service · login-gate/auth-dialog/account.css/index.html/app.js |
| 3 | T7, T8, T11, T13 | me.routes/src/app.js/rateLimit · orders.routes/order.service/testes de pedido · order-payload/checkout/app.js/cart.css · nova-senha/security.test |
| 4 | T12, T14 | account.js/app.js/account.css · docs |

Portão de cada onda: `npm test` verde. **Decisão do controlador:** T2 e T3 são executadas como **uma tarefa só** (mesmo implementador, commits separados: primeiro o fake com o real no mesmo commit do contrato, ou o real logo em seguida antes de qualquer commit vermelho) — o `repository.contract.test.js` exige que o fake e o repositório real exponham os mesmos métodos, então nenhum commit pode ter um sem o outro.
