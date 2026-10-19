---
name: barao-supabase
description: Use quando for criar ou alterar qualquer coisa de banco do Barão — supabase/migrations/*.sql (0001_schema.sql, 0002_seed_cardapio.sql, novas migrations), src/db/supabase.js, src/db/repositories/*.repo.js, o repositório fake em memória dos testes, tabelas categories/products/business_hours/settings/orders/order_items, sequence order_code_seq, funções next_order_code/create_order/orders_summary, RLS, Storage bucket product-images (upload de imagem), Supabase Auth do admin, service role key, backups; ou ao depurar erros do supabase-js ({ data, error }, PGRST116, rpc, .single()).
---

# Barão — Supabase (Postgres, Auth, Storage)

O browser **nunca** fala com o banco. Único acesso a dados: servidor Express → repositories → `supabase-js` com **service role**. A única exceção é o login do admin (`signInWithPassword` com ANON key no browser); o token vai para a API.

## Regras obrigatórias
1. Nomes de tabelas/colunas/enums exatamente como no contrato (snake_case no banco, camelCase no JS — conversão só nos repositories).
2. Dinheiro em `int` centavos (`*_cents`). Nada de `numeric`/`float`.
3. **RLS habilitado em todas as tabelas, sem policies.** Service role ignora RLS; anon/authenticated não leem nada.
4. `SUPABASE_SERVICE_ROLE_KEY` só no servidor (`.env`, nunca em `public/`, nunca logada, nunca em commit).
5. Repositories são o **único** lugar que importa `supabase-js` / chama `.from()`/`.rpc()`/`.storage`/`.auth`. Services e rotas recebem `db` por injeção.
6. **Sempre** checar `error` de toda chamada (`const { data, error } = await ...; if (error) throw dbError(op, error)`). supabase-js **não lança** em erro de query.
7. Pedido + itens gravados **atomicamente** pela rpc `create_order(payload jsonb)`; código via `next_order_code()` (sequence `order_code_seq`).

## Migrations
- Pasta `supabase/migrations/`, numeradas com 4 dígitos + descrição: `0001_schema.sql`, `0002_seed_cardapio.sql`, `0003_<descricao>.sql`...
- **Nunca editar migration já aplicada** em produção — crie a próxima. Seed de cardápio é migration (roda uma vez); alterações de preço depois são feitas pelo painel admin.
- Aplicar: Supabase CLI (`supabase db push`) ou colar no SQL Editor na ordem. Registrar no PR qual migration foi aplicada.
- SQL completo: [reference/schema.sql](reference/schema.sql) (0001) e [reference/seed.sql](reference/seed.sql) (0002).

O que a 0001 cria: tabelas do contrato + checks (endereço obrigatório se `delivery`, troco só em `cash` e `>= subtotal_cents`, `line_total_cents = unit_price_cents * quantity`, `unit_price_cents >= base_unit_cents`, telefone 10–11 dígitos), índices (inclusive GIN em `order_items.product_ids`), trigger `updated_at`, `next_order_code()`, `create_order(jsonb)`, `orders_summary(timestamptz, timestamptz)`, RLS, revokes e o bucket `product-images` (público para leitura, 2 MB, jpeg/png/webp).

## Interface do repositório (`db`)
`createApp({ db, options })` recebe em `db` um objeto com **exatamente estes métodos** — implementado por `createRepository(supabase)` (`src/db/repositories/index.js`) e pelo **fake em memória dos testes**, que deve ter a mesma forma de retorno. Todos `async`.

| Método | Retorno |
|---|---|
| `getMenu()` | `[{ id, slug, name, sortOrder, products: Product[] }]` ordenado por `sort_order` (inclui indisponíveis) |
| `getProductsByIds(ids)` | `Product[]` (ids inexistentes não aparecem) |
| `getHours()` | `[{ weekday, opensAt: 'HH:MM', closesAt: 'HH:MM', isClosed }]` |
| `updateHours(days)` | idem, após upsert dos 7 dias |
| `getSettings()` / `updateSettings({ storeOverride?, whatsappNumber? })` (só altera o que vier) | `{ storeOverride, whatsappNumber, updatedAt }` |
| `createOrder(draft)` | `{ id, code, createdAt }` |
| `listOrders({ from, to, page, pageSize })` | `{ orders: Order[], total, page, pageSize }` (`from`/`to` = `YYYY-MM-DD` locais) |
| `getOrderById(id)` | `Order \| null` |
| `updateOrderStatus(id, status)` | `Order \| null` |
| `getOrdersSummary({ from, to })` | `{ ordersCount, grossCents, topItems: [{ name, quantity }] }` |
| `listCategories()` | `[{ id, slug, name, sortOrder }]` |
| `listProducts()` / `getProductById(id)` | `Product[]` / `Product \| null` |
| `createProduct(input)` / `updateProduct(id, patch)` | `Product` / `Product \| null` |
| `deleteProduct(id)` | `true` (removido) / `false` (não existe); **lança** `AppError('PRODUCT_HAS_ORDERS', 409, ...)` se existir `order_items` com `product_ids @> array[id]` |
| `setProductAvailability(id, available)` | `Product \| null` |
| `uploadProductImage(id, { buffer, contentType })` | `Product \| null` com `imageUrl` pública |
| `getUserByAccessToken(token)` | `{ id, email } \| null` (usado por `requireAdmin`) |

`Product = { id, categoryId, kind, name, description, priceCents, imageUrl, available, sortOrder, addonGroup }` — `addonGroup` (`addon_group text null`, check `addon_group is null or kind = 'addon'`): `'borda'` nas duas bordas, `null` no resto. Addons do mesmo grupo são mutuamente exclusivos na pizza (regra aplicada no `pricing.service`, não no SQL).
`Order = { id, code, status, createdAt, customer: { name, phone }, fulfillment, address \| null, payment: { method, changeForCents }, notes, subtotalCents, items: [{ id, kind, description, productIds, flavorNames, addons: [{ name, priceCents }], baseUnitCents, unitPriceCents, quantity, notes, lineTotalCents }] }`
`draft` de `createOrder`: ver `barao-pedido-whatsapp` (`customer`, `fulfillment`, `address`, `payment`, `notes`, `subtotalCents`, `items` precificados).

Código de referência completo (client, mappers, todos os repos, `createRepository`): [reference/repositories.md](reference/repositories.md).

Regras do fake: gera códigos `BR-0001`, `BR-0002`... com o mesmo formato; rejeita (lança) se `subtotalCents` ≠ soma de `lineTotalCents` ou `unitPriceCents` ≠ `baseUnitCents` + Σ `addons.priceCents`; `deleteProduct` lança `PRODUCT_HAS_ORDERS` se algum item salvo tem o id em `productIds`; retorna cópias (não referências internas) para os testes não se contaminarem.

## Código do pedido
- `BR-` + número da sequence com 4 dígitos (`BR-0001`); acima de 9999 vira `BR-10000` (`lpad` truncaria — por isso o `case`).
- A sequence pode pular números (transação abortada). É aceitável; nunca "corrigir" com `count(*)`.
- Gerado **dentro** de `create_order`, então código e pedido nascem na mesma transação.

## Snapshot em `order_items`
- `product_ids uuid[] not null` — ids dos sabores (ou da bebida) **e** dos addons daquele item. Sem FK (o snapshot sobrevive à edição do produto); índice GIN para `product_ids @> array[id]`.
- `flavor_names text[]` (null em bebida), `addons jsonb not null default '[]'` no formato `[{ "name": "Borda Recheada com Catupiry", "priceCents": 450 }]`.
- `base_unit_cents` = pizza: preço do sabor mais caro; bebida: preço da bebida. `unit_price_cents` = base + Σ addons. `line_total_cents` = unit × quantity.
- Com isso a mensagem do WhatsApp pode ser **regenerada a partir do banco** (linha da pizza = `base_unit_cents × quantity`, cada addon = `priceCents × quantity`).
- Exclusão de produto: se `exists(select 1 from order_items where product_ids @> array[id])` → `PRODUCT_HAS_ORDERS` (409, "Produto já tem pedidos; marque como esgotado em vez de excluir"). Nunca checar por nome.

## Auth (admin)
- Usuários admin criados manualmente no painel do Supabase (Authentication → Users), e-mail/senha, "Confirm email" marcado. Desativar sign-up público (Authentication → Providers → Email → *Allow new users to sign up* off).
- Autorização real = e-mail na env `ADMIN_EMAILS` (vírgula; produção: `ADMIN_EMAILS=guslolhorta@gmail.com`), checada por `requireAdmin` via `db.getUserByAccessToken(token)` (`supabase.auth.getUser(token)`).
- **Nunca** chamar `signInWithPassword` no client service-role do servidor — ele passa a usar o JWT do usuário e cai no RLS.

## Storage
- Bucket `product-images` público para leitura (`getPublicUrl` sem request). Upload **só pelo servidor** com service role após `multer` validar tipo/tamanho. Sem policies em `storage.objects` → anon não grava.
- Caminho `products/<productId>-<timestamp>.<ext>`; salvar a URL pública em `products.image_url`. Lembrar de liberar a origem do Supabase em `img-src` do CSP.

## Erros comuns do supabase-js
- Esquecer `if (error)` → `data` é `null` e o erro estoura longe (`Cannot read properties of null`).
- `.single()` com 0 linhas → erro `PGRST116`. Para "pode não existir" use `.maybeSingle()` e retorne `null` → rota responde 404 `NOT_FOUND`.
- `.update()`/`.insert()` sem `.select()` → `data` vem `null`.
- `.rpc('create_order', { payload })` — o nome da chave tem que ser o nome do parâmetro SQL (`payload`, `p_from`, `p_to`).
- `count: 'exact'` é opção do `.select(cols, { count: 'exact' })`, não do `.range()`.
- Ordenar relação embutida: `.order('sort_order', { referencedTable: 'products' })`.
- Client criado com ANON key no servidor → tudo volta vazio (RLS sem policies), sem erro. Confira a env.
- Mensagens de erro do Postgres nunca vão para o cliente: `dbError` vira `INTERNAL` 500 e o detalhe fica no log (sem dados pessoais).

## Backups
- Plano Free do Supabase **não** tem backup diário restaurável: agendar `pg_dump` semanal (ex.: `supabase db dump --data-only > backups/AAAA-MM-DD.sql`, fora do git) ou subir para o plano Pro.
- Antes de qualquer migration em produção: dump completo. Imagens do bucket: o painel Storage permite download; manter originais das fotos também fora do Supabase.

## Checklist final
- [ ] Migration nova numerada, sem editar as anteriores; roda limpa num projeto vazio.
- [ ] RLS ligado em toda tabela nova; nenhuma policy para anon; funções novas com `revoke ... from public, anon, authenticated`.
- [ ] Repositório e fake implementam o mesmo método com o mesmo retorno (camelCase).
- [ ] Todo `{ data, error }` checado; `maybeSingle()` onde pode faltar.
- [ ] Nenhum `supabase-js` fora de `src/db/` (exceto o login do admin no browser com ANON key).
- [ ] Service role key ausente de `public/`, logs e commits.
