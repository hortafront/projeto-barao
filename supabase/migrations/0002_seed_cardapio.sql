-- 0002_seed_cardapio.sql — cardápio inicial (valores exatos do cardápio impresso)

insert into public.categories (slug, name, sort_order) values
  ('classicas',  'Pizzas Clássicas',     1),
  ('especiais',  'Pizzas Especiais',     2),
  ('bebidas',    'Bebidas',              3),
  ('adicionais', 'Adicionais Especiais', 4)
on conflict (slug) do nothing;

-- image_url: fotos provisórias (Unsplash, ver public/img/products/CREDITOS.md); substituir pelo painel.
insert into public.products (category_id, kind, name, description, price_cents, sort_order, addon_group, image_url)
select c.id, v.kind, v.name, v.description, v.price_cents, v.sort_order, v.addon_group, v.image_url
from (values
  -- Pizzas Clássicas
  ('classicas', 'pizza', 'Mista',      'Molho de tomate especial, mussarela, presunto, calabresa, cebola, azeitona e orégano', 3049, 1, null, '/img/products/mista.webp'),
  ('classicas', 'pizza', 'Calabresa',  'Molho de tomate especial, mussarela, calabresa, cebola, azeitona e orégano',           3049, 2, null, '/img/products/calabresa.webp'),
  ('classicas', 'pizza', 'Mussarela',  'Molho de tomate especial, mussarela, tomate, azeitona e orégano',                      3049, 3, null, '/img/products/mussarela.webp'),
  ('classicas', 'pizza', 'Marguerita', 'Molho de tomate especial, mussarela, manjericão, tomate, parmesão e orégano',          3490, 4, null, '/img/products/marguerita.webp'),
  -- Pizzas Especiais
  ('especiais', 'pizza', 'Frango',       'Molho de tomate especial, mussarela, frango, milho, azeitona e orégano',                               3499, 1, null, '/img/products/frango.webp'),
  ('especiais', 'pizza', 'Portuguesa',   'Molho de tomate especial, mussarela, presunto, ovos, cebola, pimentão, milho, azeitona e orégano',    3499, 2, null, '/img/products/portuguesa.webp'),
  ('especiais', 'pizza', 'Bacon',        'Molho de tomate especial, mussarela, bacon, azeitona e orégano',                                       3999, 3, null, '/img/products/bacon.webp'),
  ('especiais', 'pizza', 'Carne do Sol', 'Molho de tomate especial, mussarela, carne do sol, cebola roxa, azeitona e orégano',                    4299, 4, null, '/img/products/carne-do-sol.webp'),
  -- Bebidas
  ('bebidas', 'drink', 'Coca-Cola 600ml',               '', 600,  1, null, '/img/products/coca-cola-600.webp'),
  ('bebidas', 'drink', 'Coca-Cola 600ml Zero Açúcar',   '', 600,  2, null, '/img/products/coca-cola-600-zero.webp'),
  ('bebidas', 'drink', 'Coca-Cola 1 Litro',             '', 1000, 3, null, '/img/products/coca-cola-1l.webp'),
  ('bebidas', 'drink', 'Coca-Cola 1 Litro Zero Açúcar', '', 1000, 4, null, '/img/products/coca-cola-1l-zero.webp'),
  ('bebidas', 'drink', 'Guaraná 1 Litro',               '', 800,  5, null, '/img/products/guarana-1l.webp'),
  -- Adicionais Especiais
  -- addon_group 'borda': no máximo uma borda por pizza; catupiry por cima (null) combina com qualquer borda
  ('adicionais', 'addon', 'Borda Recheada com Catupiry',          '',                                       450, 1, 'borda', null),
  ('adicionais', 'addon', 'Finalize com Catupiry por cima',       'Mais cremosidade e sabor em cada fatia', 450, 2, null, null),
  ('adicionais', 'addon', 'Borda de Chocolate (Garoto ao Leite)', '',                                       999, 3, 'borda', null)
) as v(category_slug, kind, name, description, price_cents, sort_order, addon_group, image_url)
join public.categories c on c.slug = v.category_slug
where not exists (
  select 1 from public.products p where p.category_id = c.id and p.name = v.name
);

-- Horários (0 = domingo). Confirmado pelo dono: abre seg, qui, sex, sáb, dom das 18:00 às 23:30;
-- fecha ter (2) e qua (3).
insert into public.business_hours (weekday, opens_at, closes_at, is_closed)
select d, time '18:00', time '23:30', d in (2, 3)
from generate_series(0, 6) as d
on conflict (weekday) do nothing;
