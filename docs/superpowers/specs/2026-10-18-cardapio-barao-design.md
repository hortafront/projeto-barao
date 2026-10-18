# Spec de Design — Cardápio Web Barão

- **Data:** 2026-10-18
- **Status:** aprovado para implementação (MVP)
- **Briefing de negócio:** [`docs/BRIEFING.md`](../../BRIEFING.md)
- **Fonte de verdade:** este spec segue o contrato técnico compartilhado do projeto. Nomes de tabelas, colunas, rotas, enums, preços e formato de mensagem aqui são **exatos**. Decisões que complementam o contrato estão marcadas com **[Decisão]** e resumidas na seção 19.

---

## 1. Contexto e objetivos

O Barão – Delivery de Pizza (Fortaleza/CE) recebe pedidos por mensagens livres no WhatsApp. O projeto entrega:

1. **Cardápio público** (mobile-first) onde o cliente monta o pedido — pizza inteira ou meio a meio, adicionais, bebidas — e finaliza com entrega ou retirada.
2. **API** que valida, **recalcula o preço a partir do banco**, verifica horário/disponibilidade, salva o pedido com código `BR-0001` e devolve a mensagem pronta + URL `https://wa.me/5585997687641?text=...`.
3. **Painel admin** em `/admin` para produtos, horários, abrir/fechar a loja, histórico de pedidos e resumo de vendas.

**Objetivos técnicos**

- Zero divergência de preço: um único código de preço (`shared/pricing.js`) usado no browser (preview) e no servidor (autoridade).
- Dinheiro sempre em **centavos inteiros**.
- Front sem framework e sem bundler; Lighthouse mobile ≥ 90.
- TDD em services e rotas; testes de integração sem Supabase real.

**Não-objetivos (MVP):** pagamento online, cálculo de frete, cupons, login de cliente, app nativo, impressão automática, status em tempo real para o cliente, múltiplos tamanhos.

## 2. Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js 20+, ESM (`"type": "module"`), env via `node --env-file=.env` só no `dev` (em produção as variáveis vêm do host) |
| HTTP | Express 4, `helmet`, `cors`, `express-rate-limit`, `multer` (memória) |
| Validação | `zod` (fixado em `^3.23.8`) |
| Dados | Supabase: Postgres + Auth (admin e-mail/senha) + Storage (bucket `product-images`), via `@supabase/supabase-js` v2 com service role |
| Front | HTML/CSS/JS vanilla, ES modules nativos, sem bundler, sem framework CSS |
| Testes | `node:test`, `node:assert/strict`, `supertest`; `npm test` → `node --test` |

Scripts npm: `dev` (`node --watch --env-file=.env src/server.js`), `start` (`node src/server.js` — em produção as variáveis vêm do host), `test` (`node --test`), `lint` (opcional).

## 3. Arquitetura

```
 ┌──────────────────────────── Browser (celular) ────────────────────────────┐
 │  public/index.html  ── js/app.js, menu.js, product-modal.js, cart.js,     │
 │                        checkout.js, api.js, dom.js                         │
 │  import '/shared/pricing.js', '/shared/money.js'  (preview de preço)       │
 │  localStorage 'barao:cart:v1' (ids + quantidades)                          │
 │                                                                            │
 │  public/admin/  ── supabase-js (CDN ESM, ANON key) → signInWithPassword    │
 │                    access_token → header Authorization: Bearer ...         │
 └───────────────┬──────────────────────────────────────────┬─────────────────┘
                 │ HTTPS JSON /api/*                         │ window.location =
                 ▼                                           ▼ whatsappUrl
 ┌──────────────────────── Express (src/app.js) ─────────────┐   ┌───────────┐
 │ helmet · cors(CORS_ORIGIN) · json(20kb) · rateLimit        │   │ WhatsApp  │
 │ static: /  → public/      /shared → shared/                │   │ wa.me     │
 │                                                            │   └───────────┘
 │ routes/ (finas: HTTP ↔ service)                            │
 │   menu · status · orders · admin/* (requireAdmin)          │
 │        │                                                   │
 │ services/ (regra de negócio, puros quando possível)        │
 │   pricing · order · hours · whatsapp                       │
 │        │                    ▲ importa shared/pricing.js    │
 │ db/repositories/*.repo.js  (único ponto que fala c/ Supabase)
 └────────┬───────────────────────────────────────────────────┘
          │ service role key (somente servidor)
          ▼
 ┌─────────────────────────── Supabase ───────────────────────┐
 │ Postgres (RLS ON, sem policies p/ anon) · Auth · Storage    │
 │ tabelas: categories, products, business_hours, settings,    │
 │          orders, order_items · seq: order_code_seq          │
 │ bucket: product-images (leitura pública)                    │
 └─────────────────────────────────────────────────────────────┘
```

### 3.1 Regra de camadas

1. **routes** — fazem só tradução HTTP: aplicam `validate(schema)`, chamam um service, mapeiam o resultado para status/JSON. Sem regra de negócio, sem acesso a Supabase.
2. **services** — regra de negócio. `pricing.service.js`, `hours.service.js` e `whatsapp.service.js` são **puros** (entrada → saída, sem I/O; o relógio é injetado como parâmetro `now`). `order.service.js` orquestra e recebe o repositório por injeção.
3. **repositories** (`src/db/repositories/*.repo.js`) — único lugar que importa `src/db/supabase.js`. Convertem snake_case ↔ camelCase, devolvem objetos de domínio e **lançam** erro (nunca `{ data, error }`). `createRepository(supabase)` (`src/db/repositories/index.js`) junta todos num único objeto `db` com esta interface (o fake em memória dos testes implementa a mesma):
   - menu: `getMenu()`, `getProductsByIds(ids)`
   - loja: `getHours()`, `updateHours(days)`, `getSettings()`, `updateSettings({ storeOverride })`
   - pedidos: `createOrder(draft)`, `listOrders({ from, to, page, pageSize })`, `getOrderById(id)`, `updateOrderStatus(id, status)`, `getOrdersSummary({ from, to })`
   - produtos (admin): `listCategories()`, `listProducts()`, `getProductById(id)`, `createProduct(data)`, `updateProduct(id, patch)`, `deleteProduct(id)`, `setProductAvailability(id, available)`, `uploadProductImage(id, { buffer, contentType })`
   - auth: `getUserByAccessToken(token)`
4. **`createApp({ db, options })`** em `src/app.js` recebe o objeto de repositórios (`db`) e `options = { now, rateLimit, adminEmails, corsOrigin, supabaseUrl, supabaseAnonKey, timeZone, isProduction, trustProxy }` (cada um com default vindo do env); `src/server.js` monta `db = createRepository(createSupabaseClient())` e chama `listen`. Testes usam `createApp({ db: fakeRepo, options: { now, rateLimit: false, adminEmails, ... } })` em memória.

### 3.2 `shared/` reaproveitado no front

`shared/money.js` e `shared/pricing.js` são ES modules **puros e sem dependências**. O servidor os importa diretamente (`import { calcItemCents } from '../../shared/pricing.js'`) e o Express os serve como estáticos em `/shared` para o browser (`import { formatBRL } from '/shared/money.js'`). O preço exibido no modal e no carrinho é calculado pelo mesmo código que o servidor usa; ainda assim, **o valor do servidor é a autoridade** e é o que vai para a mensagem.

```js
// shared/money.js
export function formatBRL(cents)          // 3499 → "R$ 34,99" (Intl.NumberFormat pt-BR/BRL)
export function parseBRLToCents(input)    // "34,99" | "R$ 1.034,99" | "50.5" → 3499 | 103499 | 5050; inválido/vazio/negativo/não-string → null

// shared/pricing.js
export const LIMITS                        // { minFlavors: 1, maxFlavors: 2, minQuantity: 1, maxQuantity: 20, maxItems: 30 }
export function calcPizzaBaseCents(flavors)          // flavors: [{ priceCents }] → max dos sabores (1 ou 2)
export function calcPizzaUnitCents(flavors, addons = [])  // calcPizzaBaseCents(flavors) + Σ addons[].priceCents
export function calcItemCents(item)                  // total da linha = unitário × item.quantity
export function calcOrderSubtotalCents(items)        // Σ calcItemCents(item)
```

Formato do `item` aceito por `calcItemCents` / `calcOrderSubtotalCents`:

```js
// pizza
{ kind: 'pizza', flavors: [{ priceCents }], addons: [{ priceCents }], quantity }
// bebida
{ kind: 'drink', product: { priceCents }, quantity }
```

Entradas inválidas lançam erro: lista de sabores vazia ou com mais de 2 e quantidade fora de 1..20 (ou não inteira) → `RangeError`; preço não inteiro/negativo ou `kind` desconhecido → `TypeError`. Distinção de sabores/addons, `kind` correto de cada produto e disponibilidade são checados no servidor (`pricing.service.js`), não nas funções puras.

> **Nota de formatação [Decisão]:** `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })` emite um espaço não separável (U+00A0) entre "R$" e o número. `formatBRL` normaliza para espaço comum para que a mensagem do WhatsApp e os testes comparem strings de forma previsível.

## 4. Modelo de dados

### 4.1 Migration `supabase/migrations/0001_schema.sql`

```sql
-- 0001_schema.sql — Cardápio Web Barão
-- Dinheiro sempre em centavos (integer). Horários em America/Fortaleza.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Utilitário: updated_at automático
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name        text not null check (char_length(name) between 1 and 60),
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
create table public.products (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references public.categories(id) on delete restrict,
  kind         text not null check (kind in ('pizza','drink','addon')),
  name         text not null check (char_length(name) between 1 and 80),
  description  text not null default '' check (char_length(description) <= 300),
  price_cents  integer not null check (price_cents >= 0),
  image_url    text,
  available    boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index products_category_sort_idx on public.products (category_id, sort_order);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- business_hours (0 = domingo ... 6 = sábado)
-- closes_at <= opens_at => turno atravessa a meia-noite (ex.: 18:00 -> 00:30)
-- ---------------------------------------------------------------------------
create table public.business_hours (
  weekday    smallint primary key check (weekday between 0 and 6),
  opens_at   time not null,
  closes_at  time not null,
  is_closed  boolean not null default false
);

-- ---------------------------------------------------------------------------
-- settings (linha única, id = 1)
-- ---------------------------------------------------------------------------
create table public.settings (
  id               smallint primary key default 1 check (id = 1),
  store_override   text not null default 'auto'
                   check (store_override in ('auto','open','closed')),
  whatsapp_number  text not null default '5585997687641'
                   check (whatsapp_number ~ '^[0-9]{12,13}$'),
  updated_at       timestamptz not null default now()
);

create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

insert into public.settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Código do pedido: BR-0001, BR-0002, ... (após BR-9999 segue BR-10000)
-- ---------------------------------------------------------------------------
create sequence public.order_code_seq start with 1 increment by 1;

create or replace function public.next_order_code()
returns text
language sql
volatile
as $$
  select 'BR-' || case when n < 10000 then lpad(n::text, 4, '0') else n::text end
  from (select nextval('public.order_code_seq') as n) s;
$$;

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
create table public.orders (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique, -- gerado por create_order() via next_order_code()
  customer_name      text not null check (char_length(customer_name) between 2 and 60),
  customer_phone     text not null check (customer_phone ~ '^[0-9]{10,11}$'),
  fulfillment        text not null check (fulfillment in ('delivery','pickup')),
  address_street     text,
  address_number     text,
  address_district   text,
  address_reference  text,
  payment_method     text not null check (payment_method in ('pix','cash','card')),
  change_for_cents   integer check (change_for_cents is null or change_for_cents >= 0),
  notes              text check (notes is null or char_length(notes) <= 280),
  subtotal_cents     integer not null check (subtotal_cents >= 0),
  status             text not null default 'received'
                     check (status in ('received','confirmed','canceled')),
  created_at         timestamptz not null default now(),

  constraint orders_delivery_requires_address check (
    fulfillment = 'pickup'
    or (address_street is not null and address_number is not null and address_district is not null)
  ),
  constraint orders_pickup_has_no_address check (
    fulfillment = 'delivery'
    or (address_street is null and address_number is null
        and address_district is null and address_reference is null)
  ),
  constraint orders_change_only_for_cash check (
    payment_method = 'cash' or change_for_cents is null
  ),
  constraint orders_change_covers_subtotal check (
    change_for_cents is null or change_for_cents >= subtotal_cents
  )
);

create index orders_created_at_idx        on public.orders (created_at desc);
create index orders_status_created_at_idx on public.orders (status, created_at desc);

-- ---------------------------------------------------------------------------
-- order_items (snapshot completo: nomes, preços e ids; sem FK para products para preservar histórico)
-- ---------------------------------------------------------------------------
create table public.order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders(id) on delete cascade,
  kind              text not null check (kind in ('pizza','drink')),
  description       text not null,                    -- "Pizza meio a meio: Calabresa / Frango"
  product_ids       uuid[] not null,                  -- ids dos sabores (ou da bebida) + addons do item
  flavor_names      text[],                           -- null em bebida
  addons            jsonb not null default '[]'::jsonb, -- [{ "name": "...", "priceCents": 450 }]
  base_unit_cents   integer not null check (base_unit_cents >= 0), -- pizza: sabor mais caro; bebida: preço
  unit_price_cents  integer not null check (unit_price_cents >= 0), -- base + soma dos addons
  quantity          integer not null check (quantity between 1 and 20),
  notes             text check (notes is null or char_length(notes) <= 140),
  line_total_cents  integer not null,                 -- unit_price_cents × quantity

  constraint order_items_line_total_check check (line_total_cents = unit_price_cents * quantity),
  constraint order_items_unit_gte_base check (unit_price_cents >= base_unit_cents),
  constraint order_items_product_ids_not_empty check (cardinality(product_ids) >= 1),
  constraint order_items_addons_array check (jsonb_typeof(addons) = 'array'),
  constraint order_items_kind_shape check (
    (kind = 'pizza' and flavor_names is not null
                    and array_length(flavor_names, 1) between 1 and 2)
    or
    (kind = 'drink' and flavor_names is null and addons = '[]'::jsonb)
  )
);

create index order_items_order_id_idx    on public.order_items (order_id);
-- "produto já tem pedidos?" → where product_ids @> array[id]
create index order_items_product_ids_gin on public.order_items using gin (product_ids);

-- ---------------------------------------------------------------------------
-- create_order(payload jsonb): orders + order_items numa única transação  [Decisão]
-- O código BR-XXXX é gerado AQUI DENTRO via next_order_code() (sequence order_code_seq).
-- payload (snake_case, montado por orders.repo.js):
-- { customer_name, customer_phone, fulfillment, address_street, address_number,
--   address_district, address_reference, payment_method, change_for_cents, notes,
--   subtotal_cents, items: [{ kind, description, product_ids, flavor_names,
--   addons: [{ name, priceCents }], base_unit_cents, unit_price_cents, quantity,
--   notes, line_total_cents }] }
-- Valida: unit_price_cents = base_unit_cents + Σ addons.priceCents; subtotal = Σ line_total_cents.
-- ---------------------------------------------------------------------------
create or replace function public.create_order(payload jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_order_id   uuid;
  v_code       text;
  v_created_at timestamptz;
  v_item       jsonb;
  v_sum        int := 0;
  v_addons     jsonb;
  v_addons_sum int;
begin
  if jsonb_typeof(payload -> 'items') is distinct from 'array'
     or jsonb_array_length(payload -> 'items') = 0 then
    raise exception 'create_order: items vazio' using errcode = '22023';
  end if;

  v_code := public.next_order_code();

  insert into public.orders (
    code, customer_name, customer_phone, fulfillment,
    address_street, address_number, address_district, address_reference,
    payment_method, change_for_cents, notes, subtotal_cents
  ) values (
    v_code,
    payload ->> 'customer_name', payload ->> 'customer_phone', payload ->> 'fulfillment',
    payload ->> 'address_street', payload ->> 'address_number',
    payload ->> 'address_district', payload ->> 'address_reference',
    payload ->> 'payment_method', (payload ->> 'change_for_cents')::int,
    payload ->> 'notes', (payload ->> 'subtotal_cents')::int
  )
  returning id, created_at into v_order_id, v_created_at;

  for v_item in select value from jsonb_array_elements(payload -> 'items') loop
    v_addons := coalesce(v_item -> 'addons', '[]'::jsonb);
    select coalesce(sum((a ->> 'priceCents')::int), 0) into v_addons_sum
      from jsonb_array_elements(v_addons) as a;
    if (v_item ->> 'unit_price_cents')::int <> (v_item ->> 'base_unit_cents')::int + v_addons_sum then
      raise exception 'create_order: unit_price_cents difere de base + addons' using errcode = '22023';
    end if;

    insert into public.order_items (
      order_id, kind, description, product_ids, flavor_names, addons,
      base_unit_cents, unit_price_cents, quantity, notes, line_total_cents
    ) values (
      v_order_id, v_item ->> 'kind', v_item ->> 'description',
      array(select jsonb_array_elements_text(v_item -> 'product_ids'))::uuid[],
      case when jsonb_typeof(v_item -> 'flavor_names') = 'array'
           then array(select jsonb_array_elements_text(v_item -> 'flavor_names')) end,
      v_addons,
      (v_item ->> 'base_unit_cents')::int, (v_item ->> 'unit_price_cents')::int,
      (v_item ->> 'quantity')::int, v_item ->> 'notes', (v_item ->> 'line_total_cents')::int
    );
    v_sum := v_sum + (v_item ->> 'line_total_cents')::int;
  end loop;

  if v_sum <> (payload ->> 'subtotal_cents')::int then
    raise exception 'create_order: subtotal % difere da soma dos itens %',
      payload ->> 'subtotal_cents', v_sum using errcode = '22023';
  end if;

  return jsonb_build_object('id', v_order_id, 'code', v_code, 'created_at', v_created_at);
end;
$$;

-- Funções só podem ser executadas pelo service role
revoke all on function public.create_order(jsonb)   from public, anon, authenticated;
revoke all on function public.next_order_code()     from public, anon, authenticated;
grant execute on function public.create_order(jsonb) to service_role;
grant execute on function public.next_order_code()   to service_role;

-- ---------------------------------------------------------------------------
-- RLS: habilitado em TODAS as tabelas, sem policies (acesso só via service role)
-- ---------------------------------------------------------------------------
alter table public.categories     enable row level security;
alter table public.products       enable row level security;
alter table public.business_hours enable row level security;
alter table public.settings       enable row level security;
alter table public.orders         enable row level security;
alter table public.order_items    enable row level security;

-- ---------------------------------------------------------------------------
-- Storage: bucket público para leitura; escrita só pelo servidor (service role)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;
```

**Evolução para múltiplos tamanhos (fora do MVP):** criar `product_sizes (id, product_id, label, price_cents, sort_order)` e adicionar `size_label text null` em `order_items`. `products.price_cents` passa a ser o preço do tamanho padrão. Nenhuma coluna existente precisa mudar.

### 4.2 Seed `supabase/migrations/0002_seed_cardapio.sql` (esboço)

```sql
-- 0002_seed_cardapio.sql — cardápio inicial (valores exatos do cardápio impresso)

insert into public.categories (slug, name, sort_order) values
  ('classicas',  'Pizzas Clássicas',     1),
  ('especiais',  'Pizzas Especiais',     2),
  ('bebidas',    'Bebidas',              3),
  ('adicionais', 'Adicionais Especiais', 4)
on conflict (slug) do nothing;

insert into public.products (category_id, kind, name, description, price_cents, sort_order)
select c.id, v.kind, v.name, v.description, v.price_cents, v.sort_order
from (values
  -- Pizzas Clássicas
  ('classicas', 'pizza', 'Mista',      'Molho de tomate especial, mussarela, presunto, calabresa, cebola, azeitona e orégano', 3049, 1),
  ('classicas', 'pizza', 'Calabresa',  'Molho de tomate especial, mussarela, calabresa, cebola, azeitona e orégano',           3049, 2),
  ('classicas', 'pizza', 'Mussarela',  'Molho de tomate especial, mussarela, tomate, azeitona e orégano',                      3049, 3),
  ('classicas', 'pizza', 'Marguerita', 'Molho de tomate especial, mussarela, manjericão, tomate, parmesão e orégano',          3490, 4),
  -- Pizzas Especiais
  ('especiais', 'pizza', 'Frango',       'Molho de tomate especial, mussarela, frango, milho, azeitona e orégano',                               3499, 1),
  ('especiais', 'pizza', 'Portuguesa',   'Molho de tomate especial, mussarela, presunto, ovos, cebola, pimentão, milho, azeitona e orégano',    3499, 2),
  ('especiais', 'pizza', 'Bacon',        'Molho de tomate especial, mussarela, bacon, azeitona e orégano',                                       3999, 3),
  ('especiais', 'pizza', 'Carne do Sol', 'Molho de tomate especial, mussarela, carne do sol, cebola roxa, azeitona e orégano',                    4299, 4),
  -- Bebidas
  ('bebidas', 'drink', 'Coca-Cola 600ml',               '', 600,  1),
  ('bebidas', 'drink', 'Coca-Cola 600ml Zero Açúcar',   '', 600,  2),
  ('bebidas', 'drink', 'Coca-Cola 1 Litro',             '', 1000, 3),
  ('bebidas', 'drink', 'Coca-Cola 1 Litro Zero Açúcar', '', 1000, 4),
  ('bebidas', 'drink', 'Guaraná 1 Litro',               '', 800,  5),
  -- Adicionais Especiais
  ('adicionais', 'addon', 'Borda Recheada com Catupiry',          '',                                       450, 1),
  ('adicionais', 'addon', 'Finalize com Catupiry por cima',       'Mais cremosidade e sabor em cada fatia', 450, 2),
  ('adicionais', 'addon', 'Borda de Chocolate (Garoto ao Leite)', '',                                       999, 3)
) as v(category_slug, kind, name, description, price_cents, sort_order)
join public.categories c on c.slug = v.category_slug;

-- Horários: PLACEHOLDER 18:00–23:30 todos os dias — CONFIRMAR COM O DONO
insert into public.business_hours (weekday, opens_at, closes_at, is_closed)
select d, time '18:00', time '23:30', false
from generate_series(0, 6) as d
on conflict (weekday) do nothing;
```

## 5. Contrato da API

Prefixo `/api`, JSON (UTF-8). Respostas usam **camelCase**; o banco usa snake_case (conversão nos repositories).

### 5.1 Formato de erro (único)

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Confira os dados do pedido.", "details": [ { "path": "customer.phone", "message": "Telefone deve ter 10 ou 11 dígitos." } ] } }
```

Códigos: `STORE_CLOSED`, `VALIDATION_ERROR`, `PRODUCT_UNAVAILABLE`, `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `RATE_LIMITED`, `INTERNAL` (+ `PRODUCT_HAS_ORDERS`, ver 5.4 **[Decisão]**). Nunca há stack trace na resposta. Mapeamento completo na seção 12.

### 5.2 Rotas públicas

#### `GET /api/menu`

- **Auth:** nenhuma. Cache: `Cache-Control: public, max-age=30`.
- **Response 200:**

```json
{
  "categories": [
    {
      "slug": "classicas",
      "name": "Pizzas Clássicas",
      "products": [
        { "id": "uuid", "kind": "pizza", "name": "Mista",
          "description": "Molho de tomate especial, ...", "priceCents": 3049,
          "imageUrl": null, "available": true }
      ]
    }
  ]
}
```

- Categorias por `sort_order`; produtos por `sort_order`, depois `name`. **Inclui indisponíveis** (`available: false`) para exibir "Esgotado". Categorias sem produtos são omitidas.
- **Erros:** `500 INTERNAL`.

#### `GET /api/status`

- **Auth:** nenhuma. Cache: `no-store`.
- **Response 200:**

```json
{
  "open": false,
  "reason": "hours",
  "nextOpenAt": "2026-10-18T18:00:00-03:00",
  "todayHours": { "weekday": 0, "opensAt": "18:00", "closesAt": "23:30", "isClosed": false }
}
```

- `reason`: `hours` (decidido pela tabela de horários, override `auto`), `override_open`, `override_closed`.
- `nextOpenAt`: ISO 8601 com offset `-03:00` quando fechado e há abertura nos próximos 7 dias pelos horários; `null` quando aberto, quando `override_closed` **[Decisão: não prever reabertura sob override manual]** ou quando todos os dias estão `is_closed`.
- `todayHours`: linha de `business_hours` do dia corrente em `America/Fortaleza` **[Decisão sobre a forma do objeto]**.
- **Erros:** `500 INTERNAL`.

#### `POST /api/orders`

- **Auth:** nenhuma. **Rate limit:** 10 requisições / 10 minutos por IP → `429 RATE_LIMITED`.
- **Request:**

```json
{
  "customer": { "name": "João Silva", "phone": "85999999999" },
  "fulfillment": "delivery",
  "address": { "street": "Rua X", "number": "123", "district": "Bairro Y", "reference": "perto da praça" },
  "payment": { "method": "cash", "changeForCents": 10000 },
  "notes": "",
  "items": [
    { "kind": "pizza", "flavorIds": ["uuid-calabresa", "uuid-frango"], "addonIds": ["uuid-borda-catupiry"], "quantity": 1, "notes": "sem cebola" },
    { "kind": "drink", "productId": "uuid-coca-1l-zero", "quantity": 2 }
  ]
}
```

- **Regras de validação (Zod, `src/schemas/order.schema.js`):**

| Campo | Regra |
|---|---|
| `customer.name` | string, `trim`, 2–60 caracteres |
| `customer.phone` | remove não dígitos; 10–11 dígitos (DDD + número) |
| `fulfillment` | `delivery` \| `pickup` |
| `address` | obrigatório se `delivery`; ignorado (gravado como `null`) se `pickup`. **[Decisão]** `street` 2–120, `number` 1–10, `district` 2–60, `reference` 0–120 (vazio → `null`) |
| `payment.method` | `pix` \| `cash` \| `card` |
| `payment.changeForCents` | inteiro ≥ 0, opcional, só considerado se `cash`; se informado deve ser **≥ subtotal recalculado** (checado no service, após o recálculo); para `pix`/`card` é descartado |
| `notes` | string ≤ 280, opcional (vazio → `null`) |
| `items` | 1..30 itens, união discriminada por `kind` |
| `items[].quantity` | inteiro 1..20 |
| pizza `flavorIds` | 1 ou 2 uuids **distintos**; todos devem ser produtos `kind = 'pizza'` |
| pizza `addonIds` | 0..N uuids **distintos** (default `[]`); todos `kind = 'addon'` |
| pizza `notes` | string ≤ 140, opcional **[Decisão]** |
| drink `productId` | uuid de produto `kind = 'drink'` |
| campos extras | removidos (`strip`); qualquer `price*` enviado pelo cliente é **ignorado** |

- **Response 201:**

```json
{
  "code": "BR-0427",
  "subtotalCents": 5949,
  "message": "🍕 *Pedido BR-0427 — Barão Delivery de Pizza*\n\n*Itens*\n...",
  "whatsappUrl": "https://wa.me/5585997687641?text=%F0%9F%8D%95%20*Pedido%20BR-0427..."
}
```

- **Erros:**

| HTTP | code | Quando |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Corpo inválido; id de produto existente mas de `kind` errado; sabores repetidos; troco menor que o subtotal |
| 409 | `STORE_CLOSED` | Loja fechada (horário ou override). `details: [{ nextOpenAt }]` |
| 409 | `PRODUCT_UNAVAILABLE` | Algum produto referenciado não existe ou está `available = false`. `details: [{ productId, name }]` (`name: null` se inexistente) |
| 413 | `VALIDATION_ERROR` | Corpo > 20 kb |
| 429 | `RATE_LIMITED` | Limite por IP excedido |
| 500 | `INTERNAL` | Falha inesperada / banco |

#### `GET /api/admin-config`

- **Auth:** nenhuma — rota pública, montada **fora** do `requireAdmin` (o login precisa dela antes de ter token). Cache curto: `Cache-Control: public, max-age=300`.
- **Response 200:** `{ "supabaseUrl": "https://xxxx.supabase.co", "supabaseAnonKey": "eyJ..." }` (lidos de `SUPABASE_URL`/`SUPABASE_ANON_KEY` via `options`). A ANON key é pública por natureza; com RLS sem policies ela não lê dados. Nunca expõe a service role.

### 5.3 Autenticação admin

- Header `Authorization: Bearer <access_token Supabase>`.
- `requireAdmin` (`src/middleware/requireAdmin.js`):
  1. sem header ou formato inválido → `401 UNAUTHORIZED`;
  2. `supabase.auth.getUser(token)` falhou/expirado → `401 UNAUTHORIZED`;
  3. e-mail do usuário (minúsculo, sem espaços) fora de `ADMIN_EMAILS` (lista separada por vírgula, normalizada igual) → `403 FORBIDDEN`;
  4. ok → `req.admin = { id, email }`.
- Todas as rotas `/api/admin/*` passam por `requireAdmin` e por um rate limit geral **[Decisão: 300 req / 15 min por IP]**.

### 5.4 Rotas admin

Objeto `AdminProduct`:

```json
{ "id": "uuid", "categoryId": "uuid", "categorySlug": "especiais", "kind": "pizza",
  "name": "Bacon", "description": "...", "priceCents": 3999, "imageUrl": null,
  "available": true, "sortOrder": 3, "createdAt": "...", "updatedAt": "..." }
```

| Método e rota | Request | Response | Erros |
|---|---|---|---|
| `GET /api/admin/products` | — | `200 { products: AdminProduct[] }` (ordenado por categoria e `sortOrder`) | 401, 403 |
| `POST /api/admin/products` | `{ categoryId, kind, name, description?, priceCents, available?, sortOrder? }` | `201 { product: AdminProduct }` | 400 `VALIDATION_ERROR` (inclui `categoryId` inexistente), 401, 403 |
| `PUT /api/admin/products/:id` | mesmos campos do POST (todos obrigatórios exceto `description`, `available`, `sortOrder`) | `200 { product }` | 400, 401, 403, 404 `NOT_FOUND` |
| `DELETE /api/admin/products/:id` | — | `204` | 401, 403, 404, **409 `PRODUCT_HAS_ORDERS`** — "Produto já tem pedidos; marque como esgotado em vez de excluir" |
| `PATCH /api/admin/products/:id/availability` | `{ available: boolean }` | `200 { product }` | 400, 401, 403, 404 |
| `POST /api/admin/products/:id/image` | `multipart/form-data`, campo `image`; jpeg/png/webp; máx. 2 MB | `200 { product }` com `imageUrl` público | 400 `VALIDATION_ERROR` (tipo inválido / sem arquivo), 413 `VALIDATION_ERROR` (> 2 MB), 401, 403, 404 |
| `GET /api/admin/hours` | — | `200 { hours: [{ weekday, opensAt, closesAt, isClosed }] }` (7 itens, 0..6) | 401, 403 |
| `PUT /api/admin/hours` | `[{ weekday, opensAt: "HH:MM", closesAt: "HH:MM", isClosed }]` — exatamente 7, weekdays 0..6 sem repetição | `200 { hours }` | 400, 401, 403 |
| `GET /api/admin/settings` | — | `200 { storeOverride, whatsappNumber, updatedAt }` | 401, 403 |
| `PUT /api/admin/settings` | `{ storeOverride: "auto"\|"open"\|"closed" }` | `200 { storeOverride, whatsappNumber, updatedAt }` | 400, 401, 403 |
| `GET /api/admin/orders?from=YYYY-MM-DD&to=YYYY-MM-DD&page=1` | query | `200 { orders: [{ id, code, createdAt, customerName, customerPhone, fulfillment, paymentMethod, subtotalCents, status }], page, pageSize, total }` | 400, 401, 403 |
| `GET /api/admin/orders/:id` | — | `200 { order: { ...todos os campos de orders em camelCase, items: [{ id, kind, description, productIds, flavorNames, addons: [{ name, priceCents }], baseUnitCents, unitPriceCents, quantity, notes, lineTotalCents }] } }` | 401, 403, 404 |
| `PATCH /api/admin/orders/:id/status` | `{ status: "received"\|"confirmed"\|"canceled" }` | `200 { order }` | 400, 401, 403, 404 |
| `GET /api/admin/reports/summary?from&to` | query | `200 { ordersCount, grossCents, topItems: [{ name, quantity }] }` | 400, 401, 403 |

Detalhes **[Decisões]**:

- **Exclusão de produto:** `order_items` guarda snapshot e não tem FK para `products`, mas guarda os ids em `product_ids uuid[]` (sabores/bebida + addons, índice GIN). Se existir algum `order_item` com `product_ids @> array[id]` → `409 PRODUCT_HAS_ORDERS` ("Produto já tem pedidos; marque como esgotado em vez de excluir"); senão `DELETE` real → `204` (e remove a imagem do bucket, se houver). Nunca checar por nome. No repositório, `deleteProduct(id)` lança `AppError('PRODUCT_HAS_ORDERS', 409, ...)` ou retorna `true` (removido) / `false` (não existe → `404`); o fake em memória dos testes faz o mesmo.
- **Upload de imagem:** `multer.memoryStorage()`, `limits.fileSize = 2 * 1024 * 1024`, MIME validado por `file.mimetype` **e** pelos bytes iniciais (assinatura JPEG/PNG/WEBP). Caminho no bucket: `products/<productId>-<timestamp>.<ext>` (`upsert: false`); a imagem anterior é removida após sucesso. `image_url` recebe a URL pública.
- **Filtros de data:** `from`/`to` são datas locais `America/Fortaleza`, inclusivas. Intervalo consultado: `[from 00:00 -03:00, to+1 00:00 -03:00)`. Sem parâmetros → hoje. `from > to` ou intervalo > 366 dias → `400`.
- **Paginação:** `pageSize = 20`, `page ≥ 1`, ordenado por `created_at desc`.
- **Resumo:** considera pedidos com `status <> 'canceled'`. `ordersCount` = quantidade; `grossCents` = Σ `subtotal_cents` (bruto **estimado**, sem taxa de entrega). `topItems`: `[{ name, quantity }]` com os 10 maiores Σ `quantity` agrupados por `order_items.description` (ex.: `Pizza Calabresa`, `Pizza meio a meio: Calabresa / Frango`, `Coca-Cola 1 Litro`), ordenados por quantidade desc e depois nome; addons não entram (não são linhas de `order_items`). Calculado pela função SQL `orders_summary(p_from, p_to)` via `db.getOrdersSummary({ from, to })`.

## 6. Algoritmo de preço

Implementado em `shared/pricing.js` (puro) e aplicado por `src/services/pricing.service.js`, que busca os preços no banco.

**Passo a passo (servidor):**

1. Coletar todos os ids do pedido (`flavorIds`, `addonIds`, `productId`) e carregar os produtos numa única consulta (`db.getProductsByIds(ids)`, ids via `collectProductIds(items)`).
2. Para cada id: inexistente ou `available = false` → acumular para `409 PRODUCT_UNAVAILABLE` (`name: null` se inexistente); existente com `kind` diferente do esperado → `400 VALIDATION_ERROR`.
3. **Pizza:**
   - `flavors` / `addons` = produtos resolvidos (`[{ priceCents, ... }]`; cada addon no máximo 1x).
   - `base_unit_cents = calcPizzaBaseCents(flavors)` = **máximo** dos preços (1 sabor → o próprio preço).
   - `unit_price_cents = calcPizzaUnitCents(flavors, addons)` = base + Σ addons.
   - `line_total_cents = calcItemCents({ kind: 'pizza', flavors, addons, quantity })` = `unit_price_cents × quantity`.
4. **Bebida:** `base_unit_cents = unit_price_cents = price_cents`; `line_total_cents = calcItemCents({ kind: 'drink', product, quantity })` = `price_cents × quantity`.
5. `subtotal_cents = calcOrderSubtotalCents(items)` (mesmos objetos `item` acima) = Σ `line_total_cents`.
6. Nenhum valor vindo do cliente entra na conta.

**Exemplos numéricos (seed):**

| Item | Cálculo | Linha |
|---|---|---|
| 1x Mussarela inteira | max(3049) = 3049; addons 0; × 1 | **3049** (R$ 30,49) |
| 1x Mussarela / Carne do Sol | max(3049, 4299) = 4299; × 1 | **4299** (R$ 42,99) |
| 1x Calabresa / Frango + Borda Recheada com Catupiry | max(3049, 3499) = 3499; + 450 = 3949; × 1 | **3949** (R$ 39,49) |
| 2x Bacon + Finalize com Catupiry por cima + Borda de Chocolate (Garoto ao Leite) | 3999 + 450 + 999 = 5448; × 2 | **10896** (R$ 108,96) |
| 2x Coca-Cola 1 Litro Zero Açúcar | 1000 × 2 | **2000** (R$ 20,00) |
| 3x Guaraná 1 Litro | 800 × 3 | **2400** (R$ 24,00) |

Pedido do exemplo da mensagem (seção 9): 3949 + 2000 = **5949** → R$ 59,49.

**Troco:** se `payment.method = 'cash'` e `changeForCents` informado, exigir `changeForCents >= subtotal_cents` (ex.: subtotal 5949, troco para 5000 → `400 VALIDATION_ERROR` "O troco deve ser para um valor igual ou maior que o total do pedido.").

## 7. Algoritmo de horário

Implementado em `src/services/hours.service.js` como função pura:

```js
getStoreStatus({ now /* Date */, hours /* 7 linhas */, override /* 'auto'|'open'|'closed' */, timeZone = 'America/Fortaleza' })
// → { open, reason, nextOpenAt, todayHours }
```

1. **Override:**
   - `open` → `{ open: true, reason: 'override_open', nextOpenAt: null }`.
   - `closed` → `{ open: false, reason: 'override_closed', nextOpenAt: null }`.
   - `auto` → segue para os horários (`reason: 'hours'`).
2. **Hora local:** via `Intl.DateTimeFormat('en-US', { timeZone, weekday, hour, minute, hourCycle: 'h23' })` obter `weekday` (0 = domingo) e `minutesNow = hh*60 + mm`. Não depender do fuso do servidor.
3. **Representação do turno:** `open = toMin(opens_at)`, `close = toMin(closes_at)`. `crossesMidnight = close <= open` (`close == open` significa turno de 24h).
4. **Turno de hoje** (se `!is_closed`):
   - normal: aberto se `open <= minutesNow < close`;
   - vira a meia-noite: aberto se `minutesNow >= open`.
5. **Sobra do turno de ontem** (`weekday - 1`, mod 7, se `!is_closed` e `crossesMidnight`): aberto se `minutesNow < close`.
6. Aberto se 4 **ou** 5. Limites: abre no minuto exato de `opens_at`; fecha no minuto exato de `closes_at` (exclusivo).
7. **`nextOpenAt`** (fechado em `auto`): para `d = 0..7`, dia `weekday + d`; pular `is_closed`; candidato = data local do dia + `opens_at`; o primeiro candidato **> agora** é o resultado, formatado `YYYY-MM-DDTHH:MM:00-03:00`. Nenhum → `null`.

**Exemplos** (sábado = 6):

| Situação | Horário | Agora (local) | Resultado |
|---|---|---|---|
| Normal, dentro | sáb 18:00–23:30 | sáb 20:00 | aberto |
| Normal, fechou | sáb 18:00–23:30 | sáb 23:30 | fechado; `nextOpenAt` = dom 18:00 |
| Antes de abrir | sáb 18:00–23:30 | sáb 17:59 | fechado; `nextOpenAt` = sáb 18:00 |
| Vira meia-noite, antes de 00h | sex 18:00–00:30 | sex 23:50 | aberto (turno de hoje) |
| Vira meia-noite, depois de 00h | sex 18:00–00:30 | sáb 00:10 | aberto (sobra de sexta) |
| Vira meia-noite, encerrado | sex 18:00–00:30 | sáb 00:30 | fechado |
| Ontem fechado | sex `is_closed`, 18:00–00:30 | sáb 00:10 | fechado (sobra ignorada) |
| Override | qualquer, `closed` | sáb 20:00 | fechado, `override_closed` |
| Override | qualquer, `open` | ter 10:00 | aberto, `override_open` |

## 8. Fluxo de criação de pedido

`POST /api/orders` → `orders.routes.js` → `order.service.createOrder(input, { db, now })`:

```
1. validar        validate(orderSchema) → 400 VALIDATION_ERROR (details com path/mensagem)
2. loja aberta?   hours.getStoreStatus({ now, hours: await db.getHours(), override: (await db.getSettings()).storeOverride })
                  fechada → 409 STORE_CLOSED (details: [{ nextOpenAt }])
3. carregar       db.getProductsByIds(collectProductIds(items))  (uma consulta)
4. disponível?    existente c/ kind errado → 400 VALIDATION_ERROR
                  inexistente/available=false → 409 PRODUCT_UNAVAILABLE (details: [{ productId, name }])
5. recalcular     pricing.priceOrderItems(items, productsById) → linhas; subtotalCents = calcOrderSubtotalCents(linhas)
                  troco < subtotal → 400 VALIDATION_ERROR (assertChangeIsValid(payment, subtotalCents))
6. montar snapshot  description, product_ids, flavor_names, addons [{ name, priceCents }],
                  base_unit_cents, unit_price_cents, line_total_cents
7. salvar         db.createOrder(draft) → RPC create_order(payload jsonb) (transação única);
                  o código BR-XXXX é gerado dentro dela via next_order_code() (order_code_seq)
8. mensagem       whatsapp.buildOrderMessage({ code, order, lines }) → texto
                  whatsapp.buildWhatsappUrl(settings.whatsappNumber, texto)
9. responder      201 { code, subtotalCents, message, whatsappUrl }
```

Snapshot de `description`: pizza inteira → `Pizza Calabresa`; meio a meio → `Pizza meio a meio: Calabresa / Frango` (sabores na ordem enviada); bebida → nome do produto.

O front, ao receber 201: limpa o carrinho, mostra a tela "Pedido BR-0427 registrado" com botão "Abrir WhatsApp" e redireciona com `window.location.href = whatsappUrl` (navegação direta evita bloqueio de pop-up no celular).

## 9. Mensagem do WhatsApp

Gerada por `src/services/whatsapp.service.js` (puro). Formato **exato**:

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

**Regras de montagem:**

- Separador entre partes: travessão `—` (U+2014) com espaços. Quebras de linha `\n`.
- **Linha de pizza:** `{qtd}x {description} — {formatBRL(base_unit_cents × quantity)}` (só a pizza, sem addons); cada addon em linha própria com 3 espaços: `   + {nome} — {formatBRL(priceCents × quantity)}`; observação do item: `   Obs.: {notes}` (só se houver). Nenhuma linha mostra "unitário + addons"; a soma dos valores exibidos no bloco da pizza bate com `line_total_cents`. **[Decisão — ver 19]**
- **Linha de bebida:** `{qtd}x {nome} — {formatBRL(line_total_cents)}`.
- Telefone: 11 dígitos → `(85) 99999-9999`; 10 dígitos → `(85) 9999-9999`.
- `Ref.:` só aparece se houver referência. `*Observações:*` só aparece se houver `notes` do pedido.
- Texto livre do cliente (nome, rua, número, bairro, referência, observação do item e do pedido) passa por `oneLine(text)` = `String(text ?? '').replace(/\s+/g, ' ').trim()`: qualquer sequência de espaços em branco (quebras de linha, tabs, espaços repetidos) vira um único espaço, e as pontas são aparadas; `null`/`undefined` → `''` (linha omitida quando opcional). Nenhum outro caractere é removido ou escapado (`*`, `_`, `~` e `` ` `` são mantidos como digitados).
- URL: `https://wa.me/${settings.whatsappNumber}?text=${encodeURIComponent(message)}`.

**Variações:**

Retirada (sem linha de taxa, sem endereço):

```
*Subtotal:* R$ 59,49

*Cliente:* João Silva — (85) 99999-9999
*Retirada no balcão*
*Pagamento:* Pix
```

| Pagamento | Linha |
|---|---|
| Pix | `*Pagamento:* Pix` |
| Dinheiro com troco | `*Pagamento:* Dinheiro — troco para R$ 100,00` |
| Dinheiro sem troco | `*Pagamento:* Dinheiro` |
| Cartão | `*Pagamento:* Cartão (maquininha)` |

Pizza inteira: `1x Pizza Calabresa — R$ 30,49`. Meio a meio: `1x Pizza meio a meio: Calabresa / Frango — R$ 34,99`.

Como `order_items` guarda `description`, `base_unit_cents`, `addons` (com preço) e `line_total_cents`, a mensagem pode ser **regenerada a partir do banco** (`db.getOrderById(id)` → `buildOrderMessage`).

## 10. Front-end público

### 10.1 Páginas e módulos

`public/index.html` (`lang="pt-BR"`) contém cabeçalho (logo, slogan, selo aberto/fechado), navegação por categorias (âncoras fixas no topo), lista do cardápio, botão flutuante do carrinho com total, drawer do carrinho, modal de pizza e seção de checkout.

| Módulo | Responsabilidade |
|---|---|
| `js/app.js` | Bootstrap: busca `/api/menu` e `/api/status` em paralelo, inicializa módulos, roteia estados (carregando, erro, fechado) |
| `js/api.js` | `fetch` com timeout (10 s), parse do formato de erro único, retorna `{ ok, data }` ou `{ ok: false, error }` |
| `js/dom.js` | Helpers `el(tag, attrs, ...children)`, `text()`, `clear()`; **única forma** de criar DOM com dados (sem `innerHTML`) |
| `js/menu.js` | Renderiza categorias/produtos, selo "Esgotado", imagens `loading="lazy"` com `width/height` |
| `js/product-modal.js` | Modal de pizza (inteira/meio a meio, 2º sabor, addons, quantidade, observação, preço ao vivo) |
| `js/cart.js` | Estado do carrinho, persistência em `localStorage`, reconciliação com o menu, totais via `shared/pricing.js` |
| `js/checkout.js` | Formulário, validação leve, envio do pedido, tratamento de erros, redirecionamento ao WhatsApp |

CSS: `tokens.css` (cores, fontes, espaçamentos como custom properties), `base.css`, `menu.css`, `cart.css`; `admin.css` só no painel.

### 10.2 Carrinho (`localStorage` chave `barao:cart:v1`)

Guarda **somente ids, quantidades e observações** — nunca preços nem nomes:

```json
{
  "v": 1,
  "items": [
    { "key": "p:uuidA+uuidB|a:uuidX", "kind": "pizza", "flavorIds": ["uuidA", "uuidB"], "addonIds": ["uuidX"], "quantity": 1, "notes": "sem cebola" },
    { "key": "d:uuidD", "kind": "drink", "productId": "uuidD", "quantity": 2 }
  ]
}
```

- `key` identifica itens iguais (sabores ordenados + addons ordenados); adicionar item igual sem observação soma a quantidade (limitada a 20). Itens com observação diferente ficam separados.
- Ao carregar o menu, o carrinho é **reconciliado**: itens com id inexistente são removidos; itens com produto `available: false` ficam marcados "Esgotado — remova para continuar" e bloqueiam o checkout. Aviso discreto informa o que mudou.
- Preços exibidos = `shared/pricing.js` com preços do `/api/menu`.
- Leitura/escrita em `try/catch`; JSON inválido ou versão diferente → carrinho vazio.
- Limite de 30 itens (linhas) no carrinho, alinhado à API.

### 10.3 Modal de pizza

- Abre ao tocar numa pizza disponível. Título com o sabor escolhido.
- Seletor **Inteira / Meio a meio**. Em meio a meio, lista de sabores (clássicas e especiais, exceto o já escolhido e os esgotados) para escolher o 2º sabor. Texto de ajuda: "Na meio a meio vale o preço do sabor mais caro."
- Addons como checkboxes com preço (`+ R$ 4,50`).
- Quantidade (− / +, 1..20), observação (≤ 140 caracteres).
- Botão "Adicionar — R$ 39,49" com preço ao vivo. Desabilitado se meio a meio sem 2º sabor.
- Acessibilidade: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`; foco vai para o título ao abrir, fica preso no modal, `Esc` fecha, foco volta ao elemento que abriu.

### 10.4 Checkout

Campos: nome, telefone (`inputmode="tel"`, máscara leve), entrega/retirada (rádios), endereço (rua, número, bairro, referência — visível só em entrega), pagamento (rádios Pix / Dinheiro / Cartão), "Precisa de troco? Troco para R$" (só em dinheiro, `inputmode="decimal"`, convertido com `parseBRLToCents`), observações do pedido.

Resumo com subtotal e o aviso "Taxa de entrega a combinar pelo WhatsApp" (só em entrega). Botão "Enviar pedido pelo WhatsApp" fica em estado de carregamento e desabilitado durante o envio (evita pedido duplicado).

### 10.5 Estados

| Estado | Comportamento |
|---|---|
| Carregando | Esqueleto das categorias (sem layout shift) |
| Erro ao carregar menu | Mensagem "Não conseguimos carregar o cardápio. Verifique sua internet." + botão "Tentar de novo" + link direto para o WhatsApp |
| Loja fechada | Faixa fixa com mascote: "Estamos fechados agora — abrimos {dia} às {hora}." Cardápio navegável, botões de adicionar e checkout desabilitados. `/api/status` é consultado de novo a cada 60 s e ao voltar o foco para a aba |
| Produto esgotado | Card com opacidade reduzida e selo "Esgotado"; não abre modal; não aparece como 2º sabor |
| Carrinho vazio | Mascote + "Seu carrinho está vazio. Bateu a fome? Escolha uma pizza." |
| Erro de validação | Mensagens por campo (`aria-describedby`), foco no primeiro campo inválido |
| `STORE_CLOSED` no envio | Atualiza o selo e mostra o próximo horário; carrinho preservado |
| `PRODUCT_UNAVAILABLE` no envio | Recarrega o menu, marca os itens afetados no carrinho, pede para remover |
| `RATE_LIMITED` | "Muitas tentativas. Aguarde alguns minutos e tente de novo." |
| Sucesso | Tela "Pedido BR-0427 registrado!" + botão "Abrir WhatsApp" (caso o redirecionamento não aconteça) |

## 11. Painel admin

### 11.1 Login

1. `public/admin/index.html` carrega `supabase-js` v2 via CDN ESM (`https://cdn.jsdelivr.net`) e busca a configuração pública em `GET /api/admin-config` → `{ supabaseUrl, supabaseAnonKey }` **[Decisão]** (rota pública, sem auth; a anon key é pública por natureza; com RLS sem policies ela não lê dados).
2. Formulário e-mail/senha → `supabase.auth.signInWithPassword`.
3. Com a sessão, chama `GET /api/admin/settings` para validar o acesso: `403` → "Este e-mail não tem acesso ao painel." e `signOut()`; `200` → redireciona para `painel.html`.
4. Em `painel.html`, toda chamada usa `Authorization: Bearer ${session.access_token}` (obtido de `supabase.auth.getSession()`, que renova o token automaticamente). Qualquer `401` → `signOut()` e volta ao login.
5. Botão "Sair" → `signOut()`.

Usuários admin são criados manualmente no dashboard do Supabase (Auth → Users) e o e-mail é incluído em `ADMIN_EMAILS`. Cadastro público de usuários deve ficar **desabilitado** no Supabase Auth.

### 11.2 Telas (`painel.html`, abas)

| Aba | Conteúdo |
|---|---|
| **Pedidos** | Filtro de data (padrão: hoje), lista paginada (código, hora, cliente, entrega/retirada, pagamento, subtotal, status com cor). Pedidos `received` em destaque. Detalhe com itens, endereço, botão "Abrir conversa" (`wa.me/55{telefone}`), ações Confirmar / Cancelar / Voltar para recebido |
| **Resumo** | Período (hoje, 7 dias, mês, personalizado): nº de pedidos, faturamento bruto estimado (sem taxa de entrega, sem cancelados), top 10 itens |
| **Produtos** | Lista agrupada por categoria; alternador "Disponível/Esgotado" com um toque; editar (nome, descrição, preço em R$ convertido com `parseBRLToCents`, ordem, categoria); enviar foto (preview, validação de tipo/tamanho no cliente); excluir com confirmação (409 → sugere marcar esgotado); novo produto |
| **Horários** | 7 linhas (Domingo..Sábado) com abre/fecha e "Fechado o dia todo"; aviso quando o turno passa da meia-noite |
| **Loja** | Três opções: Automático (segue horários) / Forçar aberta / Forçar fechada, com o status atual de `/api/status` |

## 12. Tratamento de erros

`src/middleware/errorHandler.js` converte `AppError(code, message, details?, status)`, `ZodError`, erros do `multer`, `express.json` e do `express-rate-limit` para o formato único. Erro desconhecido → `500 INTERNAL` com log estruturado no servidor (sem dados de cliente além do código do pedido) e nunca stack trace na resposta.

| code | HTTP | Mensagem amigável (PT-BR) |
|---|---|---|
| `VALIDATION_ERROR` | 400 (413 para corpo/arquivo grande) | "Confira os dados informados." (+ `details` por campo) |
| `UNAUTHORIZED` | 401 | "Sua sessão expirou. Entre novamente." |
| `FORBIDDEN` | 403 | "Você não tem permissão para acessar esta área." |
| `NOT_FOUND` | 404 | "Não encontramos o que você procurou." |
| `STORE_CLOSED` | 409 | "Estamos fechados agora. Abrimos {dia} às {hora}." / "Estamos fechados no momento." |
| `PRODUCT_UNAVAILABLE` | 409 | "Ops! {itens} acabou por hoje. Remova do carrinho para continuar." |
| `PRODUCT_HAS_ORDERS` **[Decisão]** | 409 | "Produto já tem pedidos; marque como esgotado em vez de excluir" |
| `RATE_LIMITED` | 429 | "Muitas tentativas. Aguarde alguns minutos e tente de novo." |
| `INTERNAL` | 500 | "Algo deu errado do nosso lado. Tente de novo ou chame no WhatsApp." |

Rotas `/api/*` inexistentes → `404 NOT_FOUND` no mesmo formato.

## 13. Segurança

- **Segredos:** `SUPABASE_SERVICE_ROLE_KEY` só no servidor; nunca em `public/` nem em logs. `.env` no `.gitignore`; `.env.example` versionado sem valores.
- **RLS** habilitado em todas as tabelas sem policies para `anon`/`authenticated`; funções `create_order`/`next_order_code` só executáveis pelo `service_role`. Bucket `product-images` com leitura pública e escrita só via servidor.
- **Helmet + CSP:** `default-src 'self'`; `script-src 'self' https://cdn.jsdelivr.net` (supabase-js ESM do admin); `style-src 'self' https://fonts.googleapis.com`; `font-src https://fonts.gstatic.com`; `img-src 'self' data: https://<projeto>.supabase.co`; `connect-src 'self'` + origem de `SUPABASE_URL` (necessário para o login do admin); `frame-ancestors 'none'`.
- **CORS** restrito a `CORS_ORIGIN`.
- **Body:** `express.json({ limit: '20kb' })`; upload máx. 2 MB, tipos jpeg/png/webp checados por MIME e assinatura.
- **Rate limit:** `POST /api/orders` 10 req / 10 min por IP; `/api/admin/*` 300 req / 15 min por IP. Atrás de proxy (Render/Railway) usar `options.trustProxy = 1` (env opcional `TRUST_PROXY=1` → `app.set('trust proxy', 1)`) para o IP correto.
- **Autoridade do servidor:** preços, disponibilidade e horário sempre recalculados no servidor.
- **XSS:** front nunca usa `innerHTML` com dados; tudo via `dom.js` (`textContent`/`createElement`). Admin idem.
- **Admin:** allowlist `ADMIN_EMAILS`; signup público desabilitado no Supabase.
- **LGPD:** coleta mínima (nome, telefone, endereço) apenas para o pedido; não usar para marketing sem consentimento. Painel acessível apenas a admins.

## 14. Acessibilidade e performance

**Acessibilidade**

- `lang="pt-BR"`, landmarks (`header`, `nav`, `main`), headings hierárquicos.
- Contraste AA: corpo em creme `#F3E9D2` sobre `#0F3D2E` (≈ 10:1); dourado `#D4A93C` (≈ 5,5:1) para títulos e preços.
- Alvos de toque ≥ 44 × 44 px; foco visível (`:focus-visible` com contorno dourado de 3 px).
- Modal com foco preso, `Esc`, retorno de foco; drawer do carrinho idem.
- `aria-live="polite"` para total do carrinho e mensagens de erro/sucesso.
- Formulários com `label` explícito, `autocomplete` (`name`, `tel`, `street-address`), erros associados por `aria-describedby`.
- `prefers-reduced-motion` respeitado.

**Performance (meta Lighthouse mobile ≥ 90)**

- Sem framework, sem bundler; JS modular servido estático com `Cache-Control` adequado (versão por query string em deploy).
- Fontes Google com `preconnect` e `display=swap`, apenas pesos usados.
- Imagens webp, `loading="lazy"`, `decoding="async"`, `width`/`height` definidos; placeholder leve quando `imageUrl` é `null`.
- `/api/menu` e `/api/status` buscados em paralelo; compressão gzip/brotli fica a cargo do proxy da hospedagem.
- CSS crítico pequeno; nenhum recurso bloqueante de terceiros na página pública.

## 15. Estratégia de testes

TDD obrigatório em services e rotas. `npm test` → `node --test`. Integração via `createApp({ db: fakeRepo, options })` (repositório em memória com o seed) + `supertest`; o relógio é injetável (`createApp({ db, options: { now: () => fixedDate, rateLimit: false } })`) **[Decisão]**. Nenhum teste acessa Supabase real.

**Casos obrigatórios**

*Unitários — `shared/money.js`*
1. `formatBRL(3499)` → `"R$ 34,99"`; `formatBRL(0)` → `"R$ 0,00"`; `formatBRL(103499)` → `"R$ 1.034,99"`.
2. `parseBRLToCents("34,99")` → 3499; `"R$ 100"` → 10000; `"50.5"` → 5050; entrada inválida/vazia/negativa ou não-string → `null`.

*Unitários — `shared/pricing.js` / `pricing.service.js`*
3. Pizza inteira = preço do sabor.
4. Meio a meio = sabor mais caro (Mussarela/Carne do Sol = 4299), independente da ordem.
5. Addons somam por pizza e multiplicam pela quantidade (2x Bacon + 2 addons = 10896).
6. Subtotal do exemplo da mensagem = 5949.
7. Entradas inválidas (0 ou 3 sabores, quantidade 0 ou 21, preço não inteiro/negativo) lançam erro.
8. Preços enviados pelo cliente são ignorados.

*Unitários — `hours.service.js`*
9. Dentro/fora do turno normal, incluindo limites exatos (abre às 18:00, fecha às 23:30 exclusivo).
10. Turno que vira a meia-noite: aberto às 23:50 e às 00:10 do dia seguinte; fechado às 00:30.
11. Sobra de ontem ignorada se ontem `is_closed`.
12. Override `open`/`closed` prevalece sobre horários.
13. `nextOpenAt` correto (mesmo dia, dia seguinte, pulando dias fechados, `null` se todos fechados).
14. Cálculo usa `America/Fortaleza` independentemente do fuso do processo.

*Unitários — `whatsapp.service.js`*
15. Mensagem do exemplo do contrato gerada **byte a byte** igual.
16. Variação retirada (`*Retirada no balcão*`, sem linha de taxa, sem endereço).
17. Pix, Cartão (maquininha), Dinheiro com e sem troco.
18. `Ref.:` e `*Observações:*` omitidos quando vazios; addons e `Obs.:` do item com indentação de 3 espaços.
19. Pizza com quantidade 2: linha da pizza = `base_unit_cents × 2`, cada addon = `priceCents × 2`; soma = `line_total_cents`. Mensagem regenerada a partir do pedido salvo (`order_items`) = mensagem da resposta.
20. Telefone formatado (10 e 11 dígitos); `whatsappUrl` com `encodeURIComponent`.
21. `oneLine`: quebras de linha, tabs e espaços repetidos do texto livre viram um único espaço e as pontas são aparadas (demais caracteres preservados).

*Integração — rotas públicas*
22. `GET /api/menu` agrupa e ordena, inclui `available: false`.
23. `GET /api/status` aberto/fechado/override com relógio fixo.
24. `POST /api/orders` feliz (delivery + cash com troco) → 201, código `BR-0001`, subtotal correto, item e pedido salvos no fake repo.
25. `POST /api/orders` retirada sem endereço → 201, endereço gravado `null`.
26. Validações → 400: sem itens, 31 itens, quantidade 21, 3 sabores, sabores repetidos, addon repetido, addon como sabor, bebida como sabor, delivery sem endereço, telefone inválido, troco menor que o subtotal, notes > 280.
27. Loja fechada → 409 `STORE_CLOSED` com `nextOpenAt`.
28. Produto esgotado → 409 `PRODUCT_UNAVAILABLE` com o nome; id inexistente → 409 `PRODUCT_UNAVAILABLE` com `name: null`.
29. Rate limit → 11ª requisição em 10 min → 429 `RATE_LIMITED`.
30. Corpo > 20 kb → 413; erro interno do repo → 500 `INTERNAL` sem stack.

*Integração — admin*
31. Sem token → 401; token inválido → 401; e-mail fora de `ADMIN_EMAILS` → 403 (com `auth.getUser` fake).
32. CRUD de produto, `PATCH availability`, `DELETE` de produto (sabor, bebida ou addon) cujo id está em `order_items.product_ids` → 409 `PRODUCT_HAS_ORDERS`, `DELETE` de produto nunca pedido → 204, inexistente → 404. `GET /api/admin-config` sem token → 200 `{ supabaseUrl, supabaseAnonKey }`.
33. Upload: tipo inválido → 400; > 2 MB → 413; válido → `imageUrl` atualizado (storage fake).
34. `PUT /api/admin/hours` exige 7 dias únicos e `HH:MM` válido.
35. `PUT /api/admin/settings` aceita só `auto|open|closed`.
36. Pedidos: filtro por data em `America/Fortaleza`, paginação, detalhe, mudança de status.
37. Resumo: exclui cancelados, `grossCents` correto, `topItems` agrupado por `description` (top 10, desempate por nome).

*Banco (manual/CI opcional com Supabase local)*
38. Migrations aplicam do zero; checks rejeitam dados inválidos; `next_order_code()` gera `BR-0001`, `BR-0002`.

## 16. Deploy sugerido e backups

**Hospedagem:** Render (Web Service) ou Railway, Node 20, região mais próxima disponível (EUA leste ou São Paulo, se houver) + Supabase (projeto na região `sa-east-1`, São Paulo).

- Build: `npm ci`. Start em produção: **`npm start`** = `node src/server.js` **[Decisão]** — sem `--env-file` (no Node 20 a ausência do `.env` encerraria o processo); na hospedagem as variáveis vêm do painel. Só o `dev` usa `--env-file=.env`.
- Health check: `GET /api/status`.
- HTTPS fornecido pela plataforma; domínio próprio via CNAME.
- Plano gratuito pode "dormir": preferir plano pago básico ou ping de disponibilidade.

**Variáveis de ambiente**

| Variável | Exemplo | Observação |
|---|---|---|
| `PORT` | `3000` | Definida pela plataforma |
| `SUPABASE_URL` | `https://xxxx.supabase.co` | |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | **Secreta**, só servidor |
| `SUPABASE_ANON_KEY` | `eyJ...` | Pública; usada só no login do admin |
| `ADMIN_EMAILS` | `dono@exemplo.com,caixa@exemplo.com` | Separados por vírgula |
| `CORS_ORIGIN` | `https://cardapio.exemplo.com.br` | Origem do site |
| `STORE_TIMEZONE` | `America/Fortaleza` | |
| `TRUST_PROXY` | `1` | Opcional; defina atrás de proxy (Render/Railway/Nginx) para o rate limit ver o IP real |

**Migrations:** aplicar `0001_schema.sql` e `0002_seed_cardapio.sql` em ordem (Supabase CLI `supabase db push` ou SQL editor). Nunca editar migration já aplicada; mudanças vão em `0003_*.sql` em diante.

**Backups**

- Supabase: backups diários automáticos do plano (verificar retenção do plano contratado).
- Adicional semanal: `pg_dump` (via Supabase CLI `supabase db dump`) guardado fora do Supabase (ex.: drive da pizzaria), com retenção de 8 semanas.
- Imagens: o bucket `product-images` é reconstituível pelos originais; manter as fotos originais em pasta compartilhada.
- Teste de restauração antes do lançamento e a cada trimestre.

## 17. Observabilidade

- Log em uma linha JSON por requisição (método, rota, status, duração, `code` do pedido quando houver). Sem telefone/endereço nos logs.
- Erros 500 com stack apenas no log do servidor.

## 18. Estrutura de pastas (referência)

```
projeto-barao/
├── public/            index.html, css/, js/, img/, admin/ (index.html, painel.html, js/)
├── shared/            money.js, pricing.js        (servidos em /shared)
├── src/               server.js, app.js, routes/, services/, schemas/, db/, middleware/
├── supabase/migrations/ 0001_schema.sql, 0002_seed_cardapio.sql
├── tests/             unit/, integration/
├── docs/              BRIEFING.md, superpowers/specs/
├── .env.example  CLAUDE.md  package.json
```

## 19. Decisões em aberto e decisões tomadas neste spec

**Decisões tomadas aqui (complementam o contrato)**

1. **Valores na mensagem do WhatsApp:** a linha principal da pizza mostra `base_unit_cents × quantity` (só a pizza) e cada addon fica em linha própria `   + <nome> — R$ (priceCents × quantity)`, reproduzindo exatamente o exemplo do contrato (pizza R$ 34,99 + borda R$ 4,50). Ex.: `1x Pizza Calabresa — R$ 30,49`; `1x Pizza meio a meio: Calabresa / Frango — R$ 34,99`. O total do item (`line_total_cents` = `unit_price_cents × quantity`) é a soma dessas linhas.
2. **`order_items.unit_price_cents`** de pizza = preço da pizza **+ addons** (por unidade).
3. **Gravação atômica** via função SQL `create_order(payload jsonb)` chamada por RPC (`.rpc('create_order', { payload })`); o código BR-XXXX é gerado **dentro** dela por `next_order_code()` sobre `order_code_seq` (com proteção para passar de `BR-9999`).
4. **Novo código de erro `PRODUCT_HAS_ORDERS` (409)** para exclusão de produto que já aparece em pedido; verificação por id (`order_items.product_ids @> array[id]`, índice GIN), nunca por nome.
5. **Configuração pública do admin** servida pela rota pública `GET /api/admin-config` → `{ supabaseUrl, supabaseAnonKey }` (fora do `requireAdmin`, cache curto).
6. **Scripts:** `dev` = `node --watch --env-file=.env src/server.js`; `start` = `node src/server.js` (em produção as variáveis vêm do host); `test` = `node --test`.
7. Limites de texto não definidos no contrato: endereço (rua 120, número 10, bairro 60, referência 120), observação de item 140, nome de produto 80, descrição 300.
8. `todayHours` = `{ weekday, opensAt, closesAt, isClosed }`; `nextOpenAt` = `null` sob override.
9. Resumo: exclui pedidos cancelados; `topItems` top 10 agrupado por `order_items.description` (função SQL `orders_summary`).
10. Rate limit admin 300 req / 15 min por IP (o login em si ocorre no Supabase Auth, que tem limite próprio).
11. `formatBRL` usa espaço comum entre "R$" e o valor.
12. **Snapshot completo em `order_items`:** `product_ids uuid[]`, `addons jsonb` (`[{ name, priceCents }]`), `base_unit_cents`, `unit_price_cents` (= base + addons), `line_total_cents` (= unit × quantity) — permite regenerar a mensagem do WhatsApp a partir do banco.
13. **Respostas do admin:** `GET /api/admin/products` → `{ products }`; `GET /api/admin/orders` → `{ orders, page, pageSize, total }`; `GET /api/admin/orders/:id` → `{ order }` com `items`.
14. **`createApp({ db, options })`** com `options = { now, rateLimit, adminEmails, corsOrigin, supabaseUrl, supabaseAnonKey, timeZone, isProduction, trustProxy }`.

**Em aberto (dependem do dono — ver BRIEFING, seção 12)**

- Horários reais (seed é provisório).
- Exibir ou não a chave Pix.
- Meio a meio entre clássica e especial (padrão: permitido).
- Adicionais na meio a meio (padrão: permitido).
- Pode borda Catupiry + borda Chocolate na mesma pizza? (default provisório: permitido).
- Preço da Marguerita R$ 34,90 está correto?
- Domínio, e-mails do admin, fotos e arquivos de marca.

**Em aberto (técnicas, para revisar após o MVP)**

- Notificação ao admin de novos pedidos `received` (som/aba no painel) sem tempo real para o cliente.
