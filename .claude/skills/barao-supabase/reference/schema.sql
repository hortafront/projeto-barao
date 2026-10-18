-- supabase/migrations/0001_schema.sql
-- Barão – Delivery de Pizza. Fonte: contrato técnico. Dinheiro sempre em centavos (integer).
-- Acesso a dados SOMENTE pelo servidor (service role). RLS ligado em tudo, sem policies.

create extension if not exists pgcrypto; -- gen_random_uuid() (já vem no Supabase; idempotente)

-- ---------------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cardápio
-- ---------------------------------------------------------------------------
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

create table public.products (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references public.categories(id) on delete restrict,
  kind         text not null check (kind in ('pizza', 'drink', 'addon')),
  name         text not null check (char_length(name) between 1 and 80),
  description  text not null default '',
  price_cents  int  not null check (price_cents >= 0),
  image_url    text null,
  available    boolean not null default true,
  sort_order   int  not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index products_category_sort_idx on public.products (category_id, sort_order);
create trigger products_set_updated_at before update on public.products
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Funcionamento
-- ---------------------------------------------------------------------------
create table public.business_hours (
  weekday    smallint primary key check (weekday between 0 and 6), -- 0 = domingo
  opens_at   time not null,
  closes_at  time not null, -- closes_at <= opens_at => turno vira a meia-noite
  is_closed  boolean not null default false
);

create table public.settings (
  id               smallint primary key default 1 check (id = 1),
  store_override   text not null default 'auto' check (store_override in ('auto', 'open', 'closed')),
  whatsapp_number  text not null default '5585997687641' check (whatsapp_number ~ '^\d{12,13}$'),
  updated_at       timestamptz not null default now()
);
create trigger settings_set_updated_at before update on public.settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Pedidos
-- ---------------------------------------------------------------------------
create sequence public.order_code_seq start 1;

create table public.orders (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique,
  customer_name      text not null,
  customer_phone     text not null check (customer_phone ~ '^\d{10,11}$'),
  fulfillment        text not null check (fulfillment in ('delivery', 'pickup')),
  address_street     text null,
  address_number     text null,
  address_district   text null,
  address_reference  text null,
  payment_method     text not null check (payment_method in ('pix', 'cash', 'card')),
  change_for_cents   int  null check (change_for_cents is null or change_for_cents >= 0),
  notes              text null,
  subtotal_cents     int  not null check (subtotal_cents >= 0),
  status             text not null default 'received' check (status in ('received', 'confirmed', 'canceled')),
  created_at         timestamptz not null default now(),
  constraint orders_address_required check (
    fulfillment = 'pickup'
    or (address_street is not null and address_number is not null and address_district is not null)
  ),
  constraint orders_change_only_cash check (change_for_cents is null or payment_method = 'cash'),
  constraint orders_change_gte_subtotal check (change_for_cents is null or change_for_cents >= subtotal_cents)
);
create index orders_created_at_idx on public.orders (created_at desc);

create table public.order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders(id) on delete cascade,
  kind              text not null check (kind in ('pizza', 'drink')),
  description       text not null,   -- snapshot legível: "Pizza meio a meio: Calabresa / Frango"
  product_ids       uuid[] not null, -- ids dos sabores/bebida + addons do item (sem FK; snapshot)
  flavor_names      text[] null,     -- null em bebida
  addons            jsonb not null default '[]'::jsonb, -- [{ "name": "...", "priceCents": 450 }]
  base_unit_cents   int not null check (base_unit_cents >= 0), -- pizza: sabor mais caro; bebida: preço
  unit_price_cents  int not null check (unit_price_cents >= 0), -- base + soma dos addons
  quantity          int not null check (quantity between 1 and 20),
  notes             text null,
  line_total_cents  int not null,
  constraint order_items_product_ids_not_empty check (cardinality(product_ids) >= 1),
  constraint order_items_addons_array check (jsonb_typeof(addons) = 'array'),
  constraint order_items_drink_no_addons check (kind = 'pizza' or addons = '[]'::jsonb),
  constraint order_items_unit_gte_base check (unit_price_cents >= base_unit_cents),
  constraint order_items_line_total check (line_total_cents = unit_price_cents * quantity)
);
create index order_items_order_id_idx on public.order_items (order_id);
-- "produto já tem pedidos?" => where product_ids @> array[id]
create index order_items_product_ids_gin on public.order_items using gin (product_ids);

-- ---------------------------------------------------------------------------
-- Código BR-0001 (sequence; nunca count(*)+1)
-- ---------------------------------------------------------------------------
create or replace function public.next_order_code()
returns text
language sql
volatile
set search_path = public
as $$
  -- lpad TRUNCA strings maiores que 4; acima de 9999 usa o número inteiro (BR-10000)
  select 'BR-' || case when n < 10000 then lpad(n::text, 4, '0') else n::text end
  from (select nextval('public.order_code_seq') as n) s;
$$;

-- ---------------------------------------------------------------------------
-- create_order(payload jsonb): order + items numa transação (a função inteira é atômica)
-- payload (snake_case, montado por orders.repo.js):
-- { customer_name, customer_phone, fulfillment, address_street, address_number,
--   address_district, address_reference, payment_method, change_for_cents, notes,
--   subtotal_cents, items: [{ kind, description, product_ids, flavor_names,
--   addons: [{ name, priceCents }], base_unit_cents, unit_price_cents, quantity,
--   notes, line_total_cents }] }
-- Valida: unit_price_cents = base_unit_cents + Σ addons.priceCents e
--         subtotal_cents = Σ line_total_cents (line_total = unit × qtd é constraint da tabela).
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
    payload ->> 'customer_name',
    payload ->> 'customer_phone',
    payload ->> 'fulfillment',
    payload ->> 'address_street',
    payload ->> 'address_number',
    payload ->> 'address_district',
    payload ->> 'address_reference',
    payload ->> 'payment_method',
    (payload ->> 'change_for_cents')::int,
    payload ->> 'notes',
    (payload ->> 'subtotal_cents')::int
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
      v_order_id,
      v_item ->> 'kind',
      v_item ->> 'description',
      array(select jsonb_array_elements_text(v_item -> 'product_ids'))::uuid[],
      case when jsonb_typeof(v_item -> 'flavor_names') = 'array'
           then array(select jsonb_array_elements_text(v_item -> 'flavor_names')) end,
      v_addons,
      (v_item ->> 'base_unit_cents')::int,
      (v_item ->> 'unit_price_cents')::int,
      (v_item ->> 'quantity')::int,
      v_item ->> 'notes',
      (v_item ->> 'line_total_cents')::int
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

-- ---------------------------------------------------------------------------
-- Resumo para o admin (pedidos cancelados não entram)
-- ---------------------------------------------------------------------------
create or replace function public.orders_summary(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
set search_path = public
as $$
  with o as (
    select id, subtotal_cents from public.orders
    where created_at >= p_from and created_at < p_to and status <> 'canceled'
  ),
  top as (
    select oi.description as name, sum(oi.quantity)::int as quantity
    from public.order_items oi join o on o.id = oi.order_id
    group by oi.description
    order by 2 desc, 1
    limit 10
  )
  select jsonb_build_object(
    'orders_count', (select count(*) from o),
    'gross_cents',  (select coalesce(sum(subtotal_cents), 0) from o),
    'top_items',    coalesce((select jsonb_agg(top order by top.quantity desc, top.name) from top), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- Segurança: RLS em tudo, sem policies (anon/authenticated não leem nada).
-- service_role ignora RLS. Funções só para service_role.
-- ---------------------------------------------------------------------------
alter table public.categories     enable row level security;
alter table public.products       enable row level security;
alter table public.business_hours enable row level security;
alter table public.settings       enable row level security;
alter table public.orders         enable row level security;
alter table public.order_items    enable row level security;

revoke all on public.categories, public.products, public.business_hours,
              public.settings, public.orders, public.order_items from anon, authenticated;
revoke all on sequence public.order_code_seq from anon, authenticated;

revoke execute on function public.next_order_code()                          from public, anon, authenticated;
revoke execute on function public.create_order(jsonb)                       from public, anon, authenticated;
revoke execute on function public.orders_summary(timestamptz, timestamptz)  from public, anon, authenticated;
grant  execute on function public.next_order_code()                          to service_role;
grant  execute on function public.create_order(jsonb)                       to service_role;
grant  execute on function public.orders_summary(timestamptz, timestamptz)  to service_role;

-- ---------------------------------------------------------------------------
-- Storage: bucket público para leitura; escrita só pelo servidor (service role).
-- Sem policies em storage.objects => anon não faz upload.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
