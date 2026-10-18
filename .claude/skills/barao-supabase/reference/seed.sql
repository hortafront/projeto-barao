-- supabase/migrations/0002_seed_cardapio.sql
-- Cardápio exato do contrato (preços em centavos). Rodar uma única vez (é migration).
-- Catupiry/Garoto são marcas: manter os nomes como no cardápio impresso.

insert into public.categories (slug, name, sort_order) values
  ('classicas',  'Pizzas Clássicas',     1),
  ('especiais',  'Pizzas Especiais',     2),
  ('bebidas',    'Bebidas',              3),
  ('adicionais', 'Adicionais Especiais', 4);

insert into public.products (category_id, kind, name, description, price_cents, sort_order)
select c.id, v.kind, v.name, v.description, v.price_cents, v.sort_order
from (values
  -- Pizzas Clássicas
  ('classicas', 'pizza', 'Mista',       'Molho de tomate especial, mussarela, presunto, calabresa, cebola, azeitona e orégano', 3049, 1),
  ('classicas', 'pizza', 'Calabresa',   'Molho de tomate especial, mussarela, calabresa, cebola, azeitona e orégano',           3049, 2),
  ('classicas', 'pizza', 'Mussarela',   'Molho de tomate especial, mussarela, tomate, azeitona e orégano',                      3049, 3),
  ('classicas', 'pizza', 'Marguerita',  'Molho de tomate especial, mussarela, manjericão, tomate, parmesão e orégano',          3490, 4),
  -- Pizzas Especiais
  ('especiais', 'pizza', 'Frango',       'Molho de tomate especial, mussarela, frango, milho, azeitona e orégano',                                 3499, 1),
  ('especiais', 'pizza', 'Portuguesa',   'Molho de tomate especial, mussarela, presunto, ovos, cebola, pimentão, milho, azeitona e orégano',      3499, 2),
  ('especiais', 'pizza', 'Bacon',        'Molho de tomate especial, mussarela, bacon, azeitona e orégano',                                        3999, 3),
  ('especiais', 'pizza', 'Carne do Sol', 'Molho de tomate especial, mussarela, carne do sol, cebola roxa, azeitona e orégano',                    4299, 4),
  -- Bebidas
  ('bebidas', 'drink', 'Coca-Cola 600ml',                 '', 600,  1),
  ('bebidas', 'drink', 'Coca-Cola 600ml Zero Açúcar',     '', 600,  2),
  ('bebidas', 'drink', 'Coca-Cola 1 Litro',               '', 1000, 3),
  ('bebidas', 'drink', 'Coca-Cola 1 Litro Zero Açúcar',   '', 1000, 4),
  ('bebidas', 'drink', 'Guaraná 1 Litro',                 '', 800,  5),
  -- Adicionais Especiais
  ('adicionais', 'addon', 'Borda Recheada com Catupiry',          '',                                       450, 1),
  ('adicionais', 'addon', 'Finalize com Catupiry por cima',       'Mais cremosidade e sabor em cada fatia', 450, 2),
  ('adicionais', 'addon', 'Borda de Chocolate (Garoto ao Leite)', '',                                       999, 3)
) as v(category_slug, kind, name, description, price_cents, sort_order)
join public.categories c on c.slug = v.category_slug;

-- Horários: PLACEHOLDER 18:00–23:30 todos os dias. CONFIRMAR COM O DONO.
insert into public.business_hours (weekday, opens_at, closes_at, is_closed)
select d, time '18:00', time '23:30', false
from generate_series(0, 6) as d;

insert into public.settings (id, store_override, whatsapp_number)
values (1, 'auto', '5585997687641')
on conflict (id) do nothing;
