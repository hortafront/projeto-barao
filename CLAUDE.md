# CLAUDE.md — Barão – Delivery de Pizza

Cardápio web da pizzaria **Barão – Delivery de Pizza** (Fortaleza/CE). O cliente monta o pedido no site, o servidor
valida, **recalcula o preço** e salva, e o front abre o WhatsApp da loja com a mensagem pronta. O painel admin
(`/admin`) cuida de produtos, horários, status da loja, pedidos e relatórios.

- Briefing do cliente e da identidade visual: `docs/BRIEFING.md`
- Spec de design (inclui o **contrato técnico**: nomes, rotas, tabelas e enums): `docs/superpowers/specs/2026-10-18-cardapio-barao-design.md`
- Se algo aqui divergir do spec, **o spec manda**. Não invente nomes de rotas, colunas ou enums: consulte o spec.

## Stack
- Node.js **20+**, ESM (`"type": "module"`), Express 4, `@supabase/supabase-js` v2, `zod` (fixado em `^3.23.8`), `helmet`, `cors`,
  `express-rate-limit`, `multer` (upload em memória → Supabase Storage). Env via `node --env-file=.env` só no `dev`
  (sem dotenv); em produção as variáveis vêm do host.
- Front: HTML/CSS/JS vanilla, ES modules nativos, **sem bundler, sem framework, sem framework CSS**, mobile-first.
- Testes: `node:test` + `node:assert/strict` + `supertest`.
- Supabase: Postgres + Auth (login admin email/senha) + Storage (bucket `product-images`, leitura pública).

## Comandos
```bash
npm install
npm run dev                                   # node --watch --env-file=.env src/server.js
npm start                                     # node src/server.js (produção: env vem do host)
npm test                                      # node --test (unit + integration)
node --test tests/unit/pricing.test.js        # um arquivo só
node --test --test-name-pattern="meio a meio" # filtra por nome de teste
```

### .env (copiar de `.env.example`, que já traz `ADMIN_EMAILS=guslolhorta@gmail.com`; nunca commitar `.env`)
| Variável | Uso |
|---|---|
| `PORT` | porta do Express |
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | **só servidor**; repositórios usam esta chave |
| `SUPABASE_ANON_KEY` | pública; entregue ao login do admin por `GET /api/admin-config` (só `signInWithPassword`) |
| `ADMIN_EMAILS` | e-mails autorizados no painel, separados por vírgula. Produção: `ADMIN_EMAILS=guslolhorta@gmail.com` |
| `CORS_ORIGIN` | origem permitida no CORS |
| `STORE_TIMEZONE` | `America/Fortaleza` |
| `TRUST_PROXY` | opcional; `1` atrás de proxy (Render/Railway/Nginx) para o rate limit ver o IP real |

### Migrations (Supabase)
- Arquivos em `supabase/migrations/`: `0001_schema.sql` (tabelas, RLS, sequence, bucket), `0002_seed_cardapio.sql`.
- Aplicar: colar no **SQL Editor** do painel Supabase, na ordem; ou `supabase link` + `supabase db push` (CLI).
- Nunca editar migration já aplicada em produção: criar `0003_...sql` novo.

## Estrutura
```
public/index.html            cardápio + carrinho + checkout (cliente)
public/css/tokens.css        design tokens (cores, fontes, espaçamentos) — única fonte de valores visuais
public/css/                  base.css, menu.css, cart.css, admin.css
public/js/dom.js             helper de criação de DOM seguro (textContent/createElement)
public/js/api.js             fetch para /api/* + tratamento do formato de erro
public/js/cart.js            carrinho em localStorage `barao:cart:v1` (só ids e quantidades)
public/js/                   app.js, menu.js, product-modal.js, checkout.js
public/img/                  imagens estáticas (logo, mascote)
public/admin/                index.html (login), painel.html, js/
shared/money.js              formatBRL(cents), parseBRLToCents — puro, servido em /shared
shared/pricing.js            calcPizzaUnitCents, calcItemCents, calcOrderSubtotalCents — puro, servido em /shared
src/server.js                importa createApp, cria o db real e chama listen
src/app.js                   createApp({ db, options }) — monta middlewares, rotas, static; sem listen
src/routes/                  menu, status, orders (*.routes.js) + admin/*.routes.js
src/services/                pricing, order, hours, whatsapp (*.service.js) — regra de negócio
src/schemas/                 order, product, hours (*.schema.js) — Zod
src/db/supabase.js           client Supabase (service role)
src/db/repositories/         *.repo.js — ÚNICO lugar que fala com o Supabase
src/middleware/              requireAdmin, validate, errorHandler, rateLimit
supabase/migrations/         SQL versionado
tests/unit/                  services e shared/ puros
tests/integration/           rotas via supertest + createApp({ db: fakeRepo, options })
.claude/skills/              skills do projeto (ver tabela abaixo)
```

## Arquitetura
- Camadas: **routes** (finas: HTTP ↔ service) → **services** (regra de negócio, puros quando possível) →
  **repositories** (acesso a dados). Rota não chama Supabase; service não conhece `req`/`res`.
- `shared/` é **puro e sem dependências** (nem Node APIs, nem DOM): roda no servidor e no browser (servido em `/shared`).
  O front usa `shared/pricing.js` para mostrar o preço ao vivo; o servidor usa o mesmo código como autoridade.
- `createApp({ db, options })` recebe o repositório por injeção: produção passa o repo Supabase, testes passam fake em memória.
  `options = { now, rateLimit, adminEmails, corsOrigin, supabaseUrl, supabaseAnonKey, timeZone, isProduction, trustProxy }`
  (default de cada um vem do env).
- O browser **nunca** fala direto com o Supabase. Única exceção: `signInWithPassword` no login do admin (supabase-js via
  CDN ESM + ANON key; URL e key vêm da rota pública `GET /api/admin-config` → `{ supabaseUrl, supabaseAnonKey }`,
  fora do `requireAdmin`, cache curto). O token vai em `Authorization: Bearer <token>` para a API; `requireAdmin` valida com
  `supabase.auth.getUser(token)` e checa `ADMIN_EMAILS` (401 sem token/inválido, 403 e-mail fora da lista).
- RLS ligado em todas as tabelas, sem policies para anon: todo dado de negócio passa pela API Express.

## REGRAS DE NEGÓCIO INEGOCIÁVEIS
> Quebrar qualquer uma destas é bug, mesmo que o teste passe.

1. **Dinheiro = inteiro em centavos** (`*_cents` no banco, `*Cents` no JSON). Nunca float. Formatar só na borda
   (`formatBRL` / `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`).
2. **Servidor recalcula todo preço** a partir do banco. Qualquer preço enviado pelo cliente é ignorado.
3. **Meio a meio = preço do sabor mais caro.** Pizza tem 1 sabor (inteira) ou **exatamente 2 sabores distintos**;
   todos os `flavorIds` precisam ser `kind='pizza'`. Pode misturar Clássica com Especial (cobra o sabor mais caro) —
   confirmado pelo dono. Tamanho único (modelo deve permitir evoluir).
4. **Addons só em pizza**, cada addon **no máximo 1x por pizza**, somam ao unitário da pizza. **No máximo 1 addon de cada
   `addon_group` não nulo por pizza**: as duas bordas (`addon_group = 'borda'`) são mutuamente exclusivas; "Catupiry por
   cima" (`addon_group` null) combina com qualquer borda. Violação → 400 `VALIDATION_ERROR` "Escolha apenas uma borda por pizza"
   (validado no `pricing.service`). Os addons (incluindo a borda única e o Catupiry por cima) valem também na pizza
   meio a meio — confirmado pelo dono.
   Total do item (`line_total_cents`) = `unit_price_cents` (sabor mais caro + addons) × quantidade. Na mensagem do
   WhatsApp a linha da pizza mostra só `base_unit_cents × quantity` e cada addon vem em linha própria
   (`   + <nome> — R$ (priceCents × quantity)`).
5. **Taxa de entrega não é calculada**: mensagem diz "Taxa de entrega a combinar". Retirada: sem taxa, sem endereço.
   Endereço obrigatório só em `delivery`.
6. Pagamento `pix` | `cash` | `card`. Troco (`changeForCents`) só em `cash`, opcional, e deve ser **>= total do pedido**.
   O site **não exibe chave Pix**: com Pix, o checkout avisa "A chave Pix será enviada pelo WhatsApp após o pedido"
   (a loja envia a chave depois); a mensagem continua `*Pagamento:* Pix`.
7. Loja fechada (horário em `business_hours` + `settings.store_override` `auto|open|closed`) → **409 `STORE_CLOSED`**.
   Turno com `closes_at <= opens_at` vira a meia-noite (ex.: 18:00→00:30). Horário **confirmado pelo dono**:
   18:00–23:30 em seg, qui, sex, sáb e dom; **fechado ter e qua** (é o seed de `business_hours`).
8. Produto indisponível (`available=false`) ou inexistente no pedido → **409 `PRODUCT_UNAVAILABLE`**.
9. Fuso **`America/Fortaleza`** (UTC-3, sem horário de verão) em toda conta de horário e filtro de data.
10. `order_items` guarda **snapshot** completo: `description`, `product_ids uuid[]` (sabores/bebida + addons),
    `flavor_names`, `addons jsonb` (`[{ "name", "priceCents" }]`), `base_unit_cents`, `unit_price_cents`
    (= base + addons), `line_total_cents` (= unit × quantity). Pedido salvo nunca é repreçado, mesmo que o produto
    mude; a mensagem do WhatsApp pode ser regenerada a partir do banco.
11. Código do pedido `BR-0001` gerado pela sequence `order_code_seq` no banco, dentro da rpc `create_order(payload jsonb)`
    (via `next_order_code()`), que grava pedido + itens na mesma transação (não gerar no Node).
12. Limites do pedido: 1..30 itens, `quantity` 1..20, `notes` <= 280, nome 2–60, telefone 10–11 dígitos.
13. Mensagem do WhatsApp segue **exatamente** o formato do spec (gerada só em `whatsapp.service.js`, `encodeURIComponent`).
    Número vem de `settings.whatsapp_number`.

## Convenções de código
- ESM em tudo (`import`/`export`, extensões `.js` explícitas nos imports).
- Arquivos: `*.routes.js`, `*.service.js`, `*.repo.js`, `*.schema.js`, testes `*.test.js`.
- Identificadores, nomes de arquivos e commits técnicos em **inglês** no código; textos de UI, mensagens de erro ao
  usuário e mensagem do WhatsApp em **PT-BR**.
- Banco em `snake_case`; JSON da API em `camelCase` (conversão no repository).
- Formato único de erro (via `errorHandler`), nunca stack trace na resposta:
  `{ error: { code, message, details? } }` com `code` em
  `STORE_CLOSED | VALIDATION_ERROR | PRODUCT_UNAVAILABLE | PRODUCT_HAS_ORDERS | NOT_FOUND | UNAUTHORIZED | FORBIDDEN | RATE_LIMITED | INTERNAL`.
- Respostas do admin: `GET /api/admin/products` → `{ products }`; `GET /api/admin/orders` → `{ orders, page, pageSize, total }`;
  `GET /api/admin/orders/:id` → `{ order }` (com `items`).
- Front: **nunca `innerHTML` com dados** — usar `public/js/dom.js` (`textContent`, `createElement`).
- CSS: valores visuais só via variáveis de `tokens.css` (verde-escuro, dourado, creme, tijolo; fontes de título
  condensada, script, corpo sans). Mobile-first (`min-width` nas media queries).
- Acessibilidade: `lang="pt-BR"`, contraste AA, alvo de toque >= 44px, foco visível, modal com foco preso + Esc.
- Performance: imagens webp com `loading="lazy"`, meta Lighthouse mobile >= 90.
- Dependências: o mínimo. Qualquer pacote novo precisa de justificativa no commit/PR (o que resolve e por que não dá
  com o que já existe).

## Segurança
- `SUPABASE_SERVICE_ROLE_KEY` **só no servidor**; nunca em `public/`, nunca em log, nunca em resposta.
- `helmet` com CSP: só `self` + Google Fonts + `https://cdn.jsdelivr.net` (script do supabase-js no admin) +
  origem de `SUPABASE_URL` em `connect-src`/`img-src` (login do admin e imagens do bucket).
- CORS restrito a `CORS_ORIGIN`. `express.json({ limit: '20kb' })`.
- Rate limit: `POST /api/orders` 10 req / 10 min por IP (resposta 429 `RATE_LIMITED`); também nas rotas admin.
  Atrás de proxy, `TRUST_PROXY=1` (`options.trustProxy`).
- Zod no servidor é a autoridade de validação (middleware `validate`); front só faz validação leve.
- Upload de imagem: `multer` em memória, campo `image`, só `image/jpeg|png|webp`, máx **2 MB**, escrita no bucket só pelo servidor.
- Nunca logar dados pessoais completos (nome, telefone, endereço): mascarar (ex.: `(85) 9****-9999`) ou logar só o `code` do pedido.

## Fluxo de trabalho
- **TDD obrigatório** para services, `shared/` e rotas: escrever o teste, vê-lo **falhar**, implementar, vê-lo passar.
- Integração: `supertest` + `createApp({ db: fakeRepo, options: { now, rateLimit: false, ... } })` com repositório **em memória**. Testes **nunca** tocam o Supabase real.
- Testar horário com relógio injetado (`now`) — nada de depender da hora da máquina.
- Antes de dizer "pronto": rodar `npm test` e mostrar o resultado. Verde ou não está pronto.
- Commits pequenos, em PT-BR, Conventional Commits: `feat: carrinho com meio a meio`, `fix: troco menor que total`,
  `test:`, `refactor:`, `docs:`, `chore:`.

## Skills do projeto (`.claude/skills/<nome>/SKILL.md`)
| Skill | Use quando |
|---|---|
| `barao-cardapio-precos` | mexer em preço, meio a meio, addons, `shared/pricing.js`, `shared/money.js`, seed do cardápio |
| `barao-pedido-whatsapp` | `POST /api/orders`, `order.service`, `whatsapp.service`, formato da mensagem, checkout |
| `barao-supabase` | schema, migrations, RLS, Storage, repositories, Auth |
| `barao-api-express` | rotas, middlewares, Zod, formato de erro, rate limit, helmet/CORS, `createApp` |
| `barao-ui-identidade` | HTML/CSS/JS do cardápio, tokens, identidade visual, acessibilidade, `dom.js` |
| `barao-painel-admin` | `/admin`: login, produtos, upload, horários, override, pedidos, relatório |
| `barao-testes` | escrever/rodar testes, fake repo, relógio injetado, supertest |

## Não faça
- Float para dinheiro, `toFixed` em conta, ou `parseFloat` de preço.
- Confiar em preço, nome ou total vindo do front.
- Ler/escrever dados de negócio no Supabase direto do browser, ou expor a service role.
- Repreçar ou alterar itens de pedido já salvo (só o `status` muda: `received` → `confirmed` | `canceled`).
- `DELETE` de produto que já aparece em pedido (`order_items.product_ids @> array[id]` → 409 `PRODUCT_HAS_ORDERS`,
  "Produto já tem pedidos; marque como esgotado em vez de excluir"). Nunca checar "já vendido" por nome.
- Hardcode do número do WhatsApp fora de `settings.whatsapp_number` / config central.
- `new Date()` / `getHours()` sem fuso: usar `America/Fortaleza` (`Intl.DateTimeFormat` com `timeZone`).
- `innerHTML` com dados do usuário ou do banco.
- Lógica de negócio em rota ou em repositório; acesso ao Supabase fora de `src/db/`.
- Teste que chama Supabase real ou depende do horário atual.
- Adicionar framework, bundler ou biblioteca pesada no front.
- Calcular frete, pagamento online, cupons, login de cliente: **fora do escopo do MVP**.

## Pendências conhecidas
- **Fotos** dos produtos: ainda não existem; o dono enviará depois (upload pelo admin). Até lá `image_url = null` → placeholder SVG inline na identidade (nunca imagem quebrada).
- **Número do WhatsApp definitivo**: por enquanto os pedidos chegam no número provisório (85) 99273-2247; o dono enviará o definitivo; altera pelo painel em **Loja** (`PUT /api/admin/settings { whatsappNumber }`, só dígitos `^55\d{10,11}$`). Valor atual/seed (provisório) `5585992732247` em `settings.whatsapp_number`.
- **Domínio** e hospedagem (define `CORS_ORIGIN` e CSP).
- **Usuário admin no Supabase Auth**: criar `guslolhorta@gmail.com` (Auth → Users) no deploy.
