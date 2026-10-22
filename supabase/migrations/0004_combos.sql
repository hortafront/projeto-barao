-- 0004_combos.sql — Combo do dia (combos, vagas, order_items.combo_*, create_order, save_combo)
-- Aplicar depois de 0001, 0002 e 0003. Todo acesso é pelo service role no servidor.
-- "Um combo por dia" é regra do service; o banco não impõe.

-- ---------------------------------------------------------------------------
-- weekdays_valid: 1..7 valores, todos 0..6 (0 = domingo), sem repetidos.
-- (check não aceita subselect; por isso a função immutable)
-- ---------------------------------------------------------------------------
create or replace function public.weekdays_valid(p_days smallint[])
returns boolean
language sql
immutable
as $$
  select p_days is not null
     and cardinality(p_days) between 1 and 7
     and not exists (select 1 from unnest(p_days) d where d is null or d not between 0 and 6)
     and (select count(distinct d) from unnest(p_days) d) = cardinality(p_days);
$$;

-- ---------------------------------------------------------------------------
-- combos
-- ---------------------------------------------------------------------------
create table public.combos (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 2 and 60),
  description  text not null default '' check (char_length(description) <= 200),
  price_cents  integer not null check (price_cents > 0),
  image_url    text null,
  weekdays     smallint[] not null check (public.weekdays_valid(weekdays)),
  available    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger combos_set_updated_at
  before update on public.combos
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- combo_slots (1 a 4 vagas por combo: regra do service)
-- ---------------------------------------------------------------------------
create table public.combo_slots (
  id           uuid primary key default gen_random_uuid(),
  combo_id     uuid not null references public.combos(id) on delete cascade,
  position     smallint not null check (position >= 0),
  label        text not null check (char_length(label) between 2 and 40),
  kind         text not null check (kind in ('pizza','drink')),
  product_ids  uuid[] not null check (cardinality(product_ids) >= 1),

  constraint combo_slots_combo_position_key unique (combo_id, position)
);

-- ---------------------------------------------------------------------------
-- order_items: kind 'combo' + combo_id + combo_choices
-- ---------------------------------------------------------------------------
alter table public.order_items drop constraint order_items_kind_check;
alter table public.order_items
  add constraint order_items_kind_check check (kind in ('pizza','drink','combo'));

alter table public.order_items
  add column combo_id uuid null references public.combos(id) on delete restrict,
  add column combo_choices jsonb null;

create index order_items_combo_id_idx on public.order_items (combo_id);

alter table public.order_items drop constraint order_items_kind_shape;
alter table public.order_items
  add constraint order_items_kind_shape check (
    (kind = 'pizza' and flavor_names is not null
                    and array_length(flavor_names, 1) between 1 and 2
                    and combo_id is null and combo_choices is null)
    or
    (kind = 'drink' and flavor_names is null and addons = '[]'::jsonb
                    and combo_id is null and combo_choices is null)
    or
    (kind = 'combo' and flavor_names is null
                    and combo_id is not null
                    and coalesce(jsonb_typeof(combo_choices) = 'array', false))
  );

-- ---------------------------------------------------------------------------
-- create_order(payload jsonb): igual à de 0003, acrescentando combo_id e combo_choices
-- por item (item.combo_id, item.combo_choices; ausentes = null).
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
      base_unit_cents, unit_price_cents, quantity, notes, line_total_cents,
      combo_id, combo_choices
    ) values (
      v_order_id, v_pos, v_item ->> 'kind', v_item ->> 'description',
      array(select jsonb_array_elements_text(v_item -> 'product_ids'))::uuid[],
      case when jsonb_typeof(v_item -> 'flavor_names') = 'array'
           then array(select jsonb_array_elements_text(v_item -> 'flavor_names')) end,
      v_addons,
      (v_item ->> 'base_unit_cents')::int, (v_item ->> 'unit_price_cents')::int,
      (v_item ->> 'quantity')::int, v_item ->> 'notes', (v_item ->> 'line_total_cents')::int,
      nullif(v_item ->> 'combo_id', '')::uuid,
      case when jsonb_typeof(v_item -> 'combo_choices') = 'array' then v_item -> 'combo_choices' end
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
-- save_combo(p_id, payload): cria (p_id null) ou atualiza o combo e substitui as vagas
-- numa só transação. Retorna o id; null se p_id não existe.
-- payload: { name, description, price_cents, weekdays: [int], slots: [{ label, kind, product_ids }] }
-- position = índice no array (0..n-1). available e image_url não são tocados aqui.
-- ---------------------------------------------------------------------------
create or replace function public.save_combo(p_id uuid, payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id       uuid;
  v_weekdays smallint[];
begin
  v_weekdays := array(select (value)::smallint from jsonb_array_elements_text(payload -> 'weekdays'));

  if p_id is null then
    insert into public.combos (name, description, price_cents, weekdays)
    values (
      payload ->> 'name',
      coalesce(payload ->> 'description', ''),
      (payload ->> 'price_cents')::int,
      v_weekdays
    )
    returning id into v_id;
  else
    update public.combos
       set name        = payload ->> 'name',
           description = coalesce(payload ->> 'description', ''),
           price_cents = (payload ->> 'price_cents')::int,
           weekdays    = v_weekdays
     where id = p_id
    returning id into v_id;

    if v_id is null then
      return null;
    end if;

    delete from public.combo_slots where combo_id = v_id;
  end if;

  insert into public.combo_slots (combo_id, position, label, kind, product_ids)
  select v_id, (s.ord - 1)::smallint, s.slot ->> 'label', s.slot ->> 'kind',
         array(select jsonb_array_elements_text(s.slot -> 'product_ids'))::uuid[]
    from jsonb_array_elements(coalesce(payload -> 'slots', '[]'::jsonb)) with ordinality as s(slot, ord);

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS: habilitado, sem policies (acesso só via service role)
-- ---------------------------------------------------------------------------
alter table public.combos      enable row level security;
alter table public.combo_slots enable row level security;

revoke all on public.combos, public.combo_slots from anon, authenticated;

revoke execute on function public.save_combo(uuid, jsonb) from public, anon, authenticated;
grant  execute on function public.save_combo(uuid, jsonb) to service_role;
