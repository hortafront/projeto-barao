-- 0003_clientes.sql — Conta do cliente (perfil, endereços e customer_id no pedido)
-- Aplicar depois de 0001 e 0002. Todo acesso é pelo service role no servidor.

-- ---------------------------------------------------------------------------
-- customers (perfil; 1 por usuário do Supabase Auth)
-- ---------------------------------------------------------------------------
create table public.customers (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 2 and 60),
  phone       text not null check (phone ~ '^[0-9]{10,11}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- customer_addresses (máximo de 10 por cliente: regra no service)
-- ---------------------------------------------------------------------------
create table public.customer_addresses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.customers(user_id) on delete cascade,
  label       text null check (label is null or char_length(label) <= 30),
  street      text not null check (char_length(street) between 2 and 120),
  number      text not null check (char_length(number) between 1 and 10),
  district    text not null check (char_length(district) between 2 and 60),
  reference   text null check (reference is null or char_length(reference) <= 120),
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- no máximo um endereço padrão por cliente
create unique index customer_addresses_one_default
  on public.customer_addresses (user_id) where is_default;

create index customer_addresses_user_created_idx
  on public.customer_addresses (user_id, created_at desc);

create trigger customer_addresses_set_updated_at
  before update on public.customer_addresses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- orders.customer_id (nullable: preserva o histórico se a conta for excluída)
-- ---------------------------------------------------------------------------
alter table public.orders
  add column customer_id uuid null references public.customers(user_id) on delete set null;

create index orders_customer_id_idx on public.orders (customer_id);

-- ---------------------------------------------------------------------------
-- create_order(payload jsonb): igual à de 0001, acrescentando customer_id.
-- payload (snake_case, montado por orders.repo.js):
-- { customer_id (opcional), customer_name, customer_phone, fulfillment, address_street,
--   address_number, address_district, address_reference, payment_method, change_for_cents,
--   notes, subtotal_cents, items: [{ kind, description, product_ids, flavor_names,
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
  v_pos        int;
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
    code, customer_id, customer_name, customer_phone, fulfillment,
    address_street, address_number, address_district, address_reference,
    payment_method, change_for_cents, notes, subtotal_cents
  ) values (
    v_code,
    nullif(payload ->> 'customer_id', '')::uuid,
    payload ->> 'customer_name', payload ->> 'customer_phone', payload ->> 'fulfillment',
    payload ->> 'address_street', payload ->> 'address_number',
    payload ->> 'address_district', payload ->> 'address_reference',
    payload ->> 'payment_method', (payload ->> 'change_for_cents')::int,
    payload ->> 'notes', (payload ->> 'subtotal_cents')::int
  )
  returning id, created_at into v_order_id, v_created_at;

  for v_item, v_pos in select value, ordinality - 1 from jsonb_array_elements(payload -> 'items') with ordinality loop
    v_addons := coalesce(v_item -> 'addons', '[]'::jsonb);
    select coalesce(sum((a ->> 'priceCents')::int), 0) into v_addons_sum
      from jsonb_array_elements(v_addons) as a;
    if (v_item ->> 'unit_price_cents')::int <> (v_item ->> 'base_unit_cents')::int + v_addons_sum then
      raise exception 'create_order: unit_price_cents difere de base + addons' using errcode = '22023';
    end if;

    insert into public.order_items (
      order_id, position, kind, description, product_ids, flavor_names, addons,
      base_unit_cents, unit_price_cents, quantity, notes, line_total_cents
    ) values (
      v_order_id, v_pos, v_item ->> 'kind', v_item ->> 'description',
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

-- ---------------------------------------------------------------------------
-- set_default_address: troca o endereço padrão do cliente numa só chamada.
-- 0 linhas = o endereço não é do cliente (nada muda).
-- Dois comandos porque o índice único parcial não é deferrable.
-- ---------------------------------------------------------------------------
create or replace function public.set_default_address(p_user_id uuid, p_address_id uuid)
returns setof public.customer_addresses
language plpgsql
set search_path = public
as $$
begin
  update public.customer_addresses
     set is_default = false
   where user_id = p_user_id
     and is_default
     and exists (select 1 from public.customer_addresses
                  where id = p_address_id and user_id = p_user_id);

  return query
    update public.customer_addresses
       set is_default = true
     where id = p_address_id and user_id = p_user_id
    returning *;
end;
$$;

-- ---------------------------------------------------------------------------
-- delete_customer_address: apaga e, se era o padrão, promove o mais recente.
-- false = o endereço não é do cliente.
-- ---------------------------------------------------------------------------
create or replace function public.delete_customer_address(p_user_id uuid, p_address_id uuid)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_was_default boolean;
begin
  delete from public.customer_addresses
   where id = p_address_id and user_id = p_user_id
  returning is_default into v_was_default;

  if not found then
    return false;
  end if;

  if v_was_default then
    update public.customer_addresses
       set is_default = true
     where id = (select id from public.customer_addresses
                  where user_id = p_user_id
                  order by created_at desc, id desc
                  limit 1);
  end if;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS: habilitado, sem policies (acesso só via service role)
-- ---------------------------------------------------------------------------
alter table public.customers          enable row level security;
alter table public.customer_addresses enable row level security;

revoke all on public.customers, public.customer_addresses from anon, authenticated;

revoke execute on function public.set_default_address(uuid, uuid)      from public, anon, authenticated;
revoke execute on function public.delete_customer_address(uuid, uuid)  from public, anon, authenticated;
grant  execute on function public.set_default_address(uuid, uuid)      to service_role;
grant  execute on function public.delete_customer_address(uuid, uuid)  to service_role;
