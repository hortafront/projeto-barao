# Spec de Design — Conta do cliente (Cardápio Barão)

Data: 2026-10-21 · Status: aprovado em conversa, aguardando revisão do documento.
Complementa `docs/superpowers/specs/2026-10-18-cardapio-barao-design.md` (o "spec do MVP"). Onde este documento não fala, vale o spec do MVP.

## 1. Objetivo

O cliente cria uma conta com e-mail e senha para **pedir mais rápido**: nome, telefone e endereços ficam salvos e o checkout já vem preenchido.

Decisões do dono:
- **Login obrigatório para finalizar o pedido.** Montar o carrinho continua livre.
- **Sem confirmação de e-mail no cadastro**: criou a conta, já está logado. O e-mail só é usado no "Esqueci minha senha".
- **Vários endereços** por cliente, um marcado como padrão.
- Login via **Supabase Auth**; perfil e endereços passam pela **API Express** (o navegador só fala com o Supabase para autenticar — mesma regra do MVP).

Fora do escopo: histórico "Meus pedidos", "Pedir de novo", login social, login por SMS/WhatsApp, lista de clientes no painel, cupons/fidelidade.

## 2. Banco — migration `supabase/migrations/0003_clientes.sql`

O projeto Supabase existe mas está vazio; 0001, 0002 e 0003 serão aplicadas juntas, em ordem.

### 2.1 `customers` (perfil)
| coluna | tipo | regra |
|---|---|---|
| `user_id` | uuid PK | `references auth.users(id) on delete cascade` |
| `name` | text not null | `char_length` entre 2 e 60 |
| `phone` | text not null | `^[0-9]{10,11}$` (só dígitos, DDD + número) |
| `created_at`, `updated_at` | timestamptz | `updated_at` via trigger `set_updated_at()` já existente |

### 2.2 `customer_addresses`
| coluna | tipo | regra |
|---|---|---|
| `id` | uuid PK | `default gen_random_uuid()` |
| `user_id` | uuid not null | `references customers(user_id) on delete cascade` |
| `label` | text null | até 30 caracteres (ex.: "Casa", "Trabalho") |
| `street` | text not null | 2–120 (mesmos limites do pedido) |
| `number` | text not null | 1–10 |
| `district` | text not null | 2–60 |
| `reference` | text null | até 120 |
| `is_default` | boolean not null default false | |
| `created_at`, `updated_at` | timestamptz | trigger `set_updated_at()` |

- Índice único parcial: no máximo **um** `is_default = true` por `user_id`.
- Máximo de **10 endereços** por cliente (regra no service; o banco não precisa de trigger).

### 2.3 `orders`
- Nova coluna `customer_id uuid null references customers(user_id) on delete set null`, com índice.
- `create_order(payload jsonb)` passa a gravar `payload ->> 'customer_id'` (nullable no banco para preservar o histórico se a conta for excluída; a API sempre envia).
- O snapshot (`customer_name`, `customer_phone`, endereço) continua no pedido: editar o perfil não altera pedidos antigos.

### 2.4 Segurança
- RLS habilitado em `customers` e `customer_addresses`, **sem policies**; `revoke all` de `anon` e `authenticated` — mesmo padrão das tabelas do MVP. Todo acesso pelo service role no servidor.

## 3. API (Express)

### 3.1 Autenticação do cliente
- Middleware novo `requireCustomer({ db })`: lê `Authorization: Bearer <token>`, valida com `db.getUserByAccessToken(token)` (já existe) e põe `req.customer = { id, email }`. Token ausente/inválido → **401 `UNAUTHORIZED`** "Entre na sua conta para continuar.". Qualquer usuário autenticado é cliente (inclusive o e-mail do admin).
- O navegador obtém URL e chave pública do Supabase pela rota já existente `GET /api/admin-config` (o nome fica por compatibilidade; o conteúdo é público).

### 3.2 Rotas `/api/me` (todas com `requireCustomer`)
| método e rota | corpo | resposta |
|---|---|---|
| `GET /api/me` | — | `{ email, profile: { name, phone } \| null, addresses: [Address] }` (endereços: padrão primeiro, depois mais recentes) |
| `PUT /api/me` | `{ name, phone }` | `{ profile }` — cria ou atualiza (upsert) |
| `POST /api/me/addresses` | `{ label?, street, number, district, reference?, isDefault? }` | 201 `{ address }`; 11º endereço → 400 `VALIDATION_ERROR` "Você pode salvar até 10 endereços."; sem perfil → 400 `VALIDATION_ERROR` "Complete seu perfil antes de salvar endereços." |
| `PUT /api/me/addresses/:id` | mesmo corpo | `{ address }`; id de outro cliente ou inexistente → 404 |
| `DELETE /api/me/addresses/:id` | — | 204; se era o padrão e sobrar algum, o mais recente vira padrão |
| `PATCH /api/me/addresses/:id/default` | — | `{ address }` (desmarca o anterior na mesma operação) |
| `DELETE /api/me` | — | 204: apaga perfil e endereços e o usuário no Supabase Auth (`auth.admin.deleteUser`); pedidos ficam com `customer_id = null` |

- Primeiro endereço salvo vira padrão automaticamente.
- Um cliente nunca acessa dados de outro: toda consulta filtra por `req.customer.id`.
- Validação com Zod (mensagens PT-BR, mesmos limites e `freeText` do pedido); telefone aceito com máscara e normalizado para dígitos.

### 3.3 `POST /api/orders`
- Passa a usar `requireCustomer`: sem login → 401 (o front abre o login antes, então isso só acontece com sessão expirada).
- `createOrder` recebe `customerId` e o grava; o corpo do pedido **não muda** (nome, telefone e endereço continuam no body, vindos do checkout pré-preenchido). Preço recalculado, loja fechada, WhatsApp — tudo igual ao MVP.

### 3.4 Repositório (`db`)
Métodos novos, no repositório Supabase e no `fakeDb` (mesma interface):
`getCustomer(userId)`, `upsertCustomer(userId, { name, phone })`, `listAddresses(userId)`, `createAddress(userId, data)`, `updateAddress(userId, id, data)`, `deleteAddress(userId, id)`, `setDefaultAddress(userId, id)`, `deleteCustomerAccount(userId)`.
`createOrder(draft)` aceita `customerId`.

### 3.5 Códigos de erro
Nenhum código novo: 401 `UNAUTHORIZED`, 400 `VALIDATION_ERROR`, 404 `NOT_FOUND`.

## 4. Front-end do cliente

### 4.1 Sessão
- Novo módulo `public/js/auth.js`: supabase-js via CDN ESM (`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm`, já liberado no CSP), sessão em **`localStorage`** (o cliente continua logado entre visitas até "Sair"), chave própria `barao-cliente-auth` (separada da sessão do admin).
- Exporta: `getSession()`, `signUp({ name, phone, email, password })`, `signIn({ email, password })`, `signOut()`, `requestPasswordReset(email)`, `updatePassword(newPassword)`, `onAuthChange(fn)` e `customerApi(path, opts)` (fetch com Bearer; 401 → tenta um refresh, se falhar volta ao estado deslogado).
- `api.js`: `createOrder` passa a enviar o Bearer quando houver sessão.

### 4.2 Header
- Botão **"Entrar"** à direita (antes do selo Aberto/Fechado); logado vira **"Minha conta"**.

### 4.3 Janela "Entrar / Criar conta" (`<dialog>`, abas)
- **Entrar**: e-mail, senha, "Esqueci minha senha".
- **Criar conta**: nome, telefone (máscara (85) 99999-9999), e-mail, senha (mín. 8). Fluxo: `signUp` → já logado → `PUT /api/me` com nome e telefone.
- **Perfil incompleto**: se o cliente está logado mas `GET /api/me` volta `profile: null` (ex.: o `PUT /api/me` do cadastro falhou por rede), ao abrir o checkout ou "Minha conta" aparece primeiro o formulário "Complete seu perfil" (nome e telefone).
- Mensagens: "E-mail ou senha incorretos.", "Já existe uma conta com esse e-mail. Quer entrar?", "A senha precisa ter pelo menos 8 caracteres.", erro de rede.

### 4.4 Checkout
- "Finalizar pedido" sem sessão → abre a janela de login; ao entrar, segue para o checkout com o carrinho intacto.
- Com sessão: nome e telefone vêm do perfil (editáveis só neste pedido); endereço = lista dos salvos (rádio, padrão marcado) + **"Usar outro endereço"** com o formulário atual e a caixa **"Salvar este endereço"** (salva após o 201 do pedido; falha ao salvar não afeta o pedido).
- Retirada no balcão: lista de endereços oculta, como hoje.

### 4.5 Janela "Minha conta"
- Editar nome e telefone; lista de endereços com editar, apagar e "Tornar padrão"; adicionar endereço; **Sair**; **Excluir minha conta** (confirmação com o texto "Isso apaga seus dados e endereços. Seus pedidos anteriores continuam registrados na pizzaria.").

### 4.6 Nova senha
- Página `public/conta/nova-senha.html` (+ módulo): recebe o link de recuperação do Supabase, pede a nova senha (mín. 8) e confirma; ao terminar, volta ao cardápio logado.
- Exige serviço de e-mail configurado no Supabase (Resend ou outro SMTP) — documentar no `docs/DEPLOY.md`, junto de: "Confirm email" **desligado**, Site URL e Redirect URL `https://<domínio>/conta/nova-senha.html`.

### 4.7 Regras de front
Mesmas do MVP: `el()` sem `innerHTML`, CSS só com tokens, sem script/style inline, PT-BR, acessibilidade (foco preso no dialog, Esc, `aria-live` nos erros, alvos ≥ 44px).

## 5. Painel admin
Sem mudanças. O admin continua separado por `ADMIN_EMAILS`; um cliente comum recebe 403 no painel.

## 6. Testes
- **Unit:** schemas de perfil e endereço (limites, mensagens PT-BR, telefone com máscara); lógica pura do checkout com endereços salvos (`addressChoice` → body do pedido); máscara/normalização do telefone.
- **Integração (supertest + fakeDb):** `/api/me` 401 sem token; perfil upsert; CRUD de endereços; 11º endereço → 400; um padrão só; apagar o padrão promove outro; cliente B não lê/edita/apaga endereço do cliente A (404); `DELETE /api/me`; `POST /api/orders` sem token → 401 e com token grava `customerId`.
- **SQL:** 0001+0002+0003 no PGlite (fora do repo): constraints, índice de padrão único, `create_order` com `customer_id`, `on delete set null` no pedido.
- **Manual (após deploy):** criar conta, pedir, sair/entrar, esqueci a senha com e-mail real, excluir conta.

## 7. Deploy
- Aplicar `0001`, `0002` e `0003` no SQL Editor, nessa ordem.
- Auth → Providers → Email: "Confirm email" **desligado**; SMTP (Resend) configurado; URL de redirecionamento da recuperação de senha.
- Signup público **ligado** (antes o DEPLOY.md mandava desligar — o admin continua protegido por `ADMIN_EMAILS`).

## 8. Riscos
- Signup aberto permite contas falsas: mitigado pelo rate limit do próprio Supabase Auth; o pedido continua exigindo dados válidos e loja aberta.
- Sem SMTP configurado, "Esqueci minha senha" não funciona em produção (o resto funciona).
