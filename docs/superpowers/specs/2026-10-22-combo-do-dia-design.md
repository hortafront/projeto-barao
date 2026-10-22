# Spec de Design — Combo do dia (Cardápio Barão)

Data: 2026-10-22 · Status: design aprovado em conversa, aguardando revisão do documento.
Complementa o spec do MVP (`2026-10-18-cardapio-barao-design.md`) e o da conta do cliente (`2026-10-21-conta-cliente-design.md`). Onde este documento não fala, valem eles.

## 1. Objetivo

O dono cadastra no painel o **combo do dia**: um item com preço próprio e "vagas" de escolha (ex.: "1 pizza clássica à escolha + 1 refrigerante 1L à escolha por R$ 36,90"), que aparece no cardápio só nos dias da semana marcados e que o cliente adiciona ao carrinho.

Decisões do dono:
- **Combo com escolha**: cada vaga lista os produtos permitidos; o cliente escolhe um item por vaga.
- **Pizza do combo funciona como pizza normal**: inteira ou meio a meio (2 sabores distintos, ambos permitidos na vaga), com adicionais que **somam** ao preço do combo. O sabor escolhido **não** altera o preço: o dono controla isso escolhendo os sabores permitidos.
- **Dias da semana**: o combo aparece só nos dias marcados (sem período de datas).
- **No máximo um combo por dia da semana.**
- Botão **Esgotado** no combo, como nos produtos (decisão de design aceita pelo dono).

Fora do escopo: desconto em porcentagem, combo por período de datas, mais de um combo no mesmo dia, limite de quantidade por dia, combo com vaga de adicional/bebida opcional.

## 2. Banco — migration `supabase/migrations/0004_combos.sql`

0001–0003 já estão aplicadas em produção: **não editar**; tudo novo vai na 0004.

### 2.1 `combos`
| coluna | tipo | regra |
|---|---|---|
| `id` | uuid PK | `default gen_random_uuid()` |
| `name` | text not null | 2–60 |
| `description` | text not null default `''` | até 200 |
| `price_cents` | integer not null | `> 0` |
| `image_url` | text null | mesmo bucket `product-images` |
| `weekdays` | smallint[] not null | ao menos 1 elemento, cada um 0–6 (0 = domingo), sem repetidos |
| `available` | boolean not null default true | "Esgotado" quando false |
| `created_at`, `updated_at` | timestamptz | trigger `set_updated_at()` |

"Um combo por dia" é regra do **service** (com mensagem amigável); o banco não precisa de trigger.

### 2.2 `combo_slots`
| coluna | tipo | regra |
|---|---|---|
| `id` | uuid PK | |
| `combo_id` | uuid not null | `references combos(id) on delete cascade` |
| `position` | smallint not null | `>= 0`, `unique (combo_id, position)` |
| `label` | text not null | 2–40 (ex.: "Escolha sua pizza") |
| `kind` | text not null | `'pizza' | 'drink'` |
| `product_ids` | uuid[] not null | ao menos 1; todos do `kind` correspondente (validado no service) |

Um combo tem de **1 a 4 vagas**. Cada vaga vale **um** item.

### 2.3 `order_items`
- `kind` passa a aceitar `'combo'`.
- Colunas novas: `combo_id uuid null references combos(id) on delete restrict` e `combo_choices jsonb null`.
- `combo_choices` (snapshot, só em combo): `[{ "label", "kind", "description", "addons": [{ "name", "priceCents" }] }]` na ordem das vagas. `description` de pizza segue o padrão atual ("Pizza Calabresa" / "Pizza meio a meio: Calabresa / Mussarela"); de bebida, o nome do produto.
- Em combo: `description` = nome do combo; `product_ids` = todos os produtos escolhidos + adicionais (mantém a checagem de `PRODUCT_HAS_ORDERS`); `flavor_names` null; `addons` = lista achatada de todos os adicionais do combo; `base_unit_cents` = preço do combo; `unit_price_cents` = base + adicionais; `line_total_cents` = unit × quantity.
- A constraint `order_items_kind_shape` é recriada incluindo o caso `combo` (`combo_id` e `combo_choices` não nulos; nos outros kinds, ambos nulos).
- `create_order(payload jsonb)` é redefinida para gravar `combo_id` e `combo_choices` (mesma assinatura, grants e comportamento atuais, incluindo `position` e `customer_id`).

### 2.4 Segurança
RLS ligado em `combos` e `combo_slots`, sem policies; `revoke all` de `anon` e `authenticated` — mesmo padrão. Acesso só pelo servidor.

## 3. API

### 3.1 `GET /api/menu`
Passa a responder `{ categories, combo }`, onde `combo` é o combo de **hoje** ou `null`:
`{ id, name, description, priceCents, imageUrl, available, slots: [{ id, position, label, kind, productIds }] }` (slots por `position`).
- "Hoje" = dia da semana local em `America/Fortaleza` (usar `getLocalParts` do `hours.service`, relógio injetável `now`).
- Combo esgotado vem com `available: false` (o front mostra "Esgotado hoje").
- O cache da resposta não pode atravessar a troca de dia (cache curto, como hoje ou menor).

### 3.2 `POST /api/orders` — item combo
Novo formato no `orderItemSchema` (discriminated union por `kind`):
```json
{ "kind": "combo", "comboId": "uuid", "quantity": 1, "notes": "opcional",
  "slots": [ { "kind": "pizza", "flavorIds": ["uuid"], "addonIds": [] },
             { "kind": "drink", "productId": "uuid" } ] }
```
- `slots` na ordem das vagas do combo; quantidade e `kind` de cada slot têm de bater com as vagas.
- Pizza do slot: 1 sabor ou exatamente 2 distintos, todos em `product_ids` da vaga; adicionais seguem as regras atuais (cada um no máx. 1x, no máx. 1 por `addon_group`).
- Bebida do slot: `productId` em `product_ids` da vaga.
- Preço (servidor, a partir do banco): `unit = combo.price_cents + soma dos adicionais`; `line = unit × quantity`.

Erros (sem códigos novos):
| situação | resposta |
|---|---|
| combo inexistente, esgotado ou fora do dia de hoje | 409 `PRODUCT_UNAVAILABLE` "O {nome} não está disponível hoje." (inexistente: "Este combo não está mais disponível.") |
| slots em número/kind diferente das vagas, produto fora da vaga, sabor repetido | 400 `VALIDATION_ERROR` com `details` no slot |
| produto escolhido esgotado/inexistente | 409 `PRODUCT_UNAVAILABLE` (mensagem atual de item esgotado) |
| duas bordas na mesma pizza | 400 "Escolha apenas uma borda por pizza" (atual) |

Loja fechada, login obrigatório, limites do pedido (1..30 itens, quantity 1..20) — tudo igual.

### 3.3 Admin (`requireAdmin`, rate limit admin)
| método e rota | corpo / resposta |
|---|---|
| `GET /api/admin/combos` | `{ combos }` (com `slots`) |
| `POST /api/admin/combos` | `{ name, description?, priceCents, weekdays, slots: [{ label, kind, productIds }] }` → 201 `{ combo }` |
| `PUT /api/admin/combos/:id` | mesmo corpo → `{ combo }` (substitui as vagas) |
| `DELETE /api/admin/combos/:id` | 204; se algum `order_items.combo_id` = id → 409 `PRODUCT_HAS_ORDERS` "Combo já tem pedidos; marque como esgotado em vez de excluir" |
| `PATCH /api/admin/combos/:id/availability` | `{ available }` → `{ combo }` |
| `POST /api/admin/combos/:id/image` | multipart `image` (jpeg/png/webp, 2 MB) → `{ combo }` |

- Dia já usado por outro combo → 400 `VALIDATION_ERROR` "Já existe um combo na {dia}: {nome}." com `details` em `weekdays`.
- `productIds` de vaga `pizza` têm de ser `kind='pizza'`; de `drink`, `kind='drink'` → senão 400.
- Gravação de combo + vagas atômica (rpc ou transação no repositório).

### 3.4 Repositório (`db`) — Supabase e `fakeDb` com a mesma interface
`getTodayCombo(weekday)`, `listCombos()`, `getCombo(id)`, `getCombosByIds(ids)`, `createCombo(data)`, `updateCombo(id, data)`, `deleteCombo(id)`, `setComboAvailability(id, available)`, `uploadComboImage(id, { buffer, contentType })` (mesmo padrão de `uploadProductImage`). `createOrder` grava `comboId`/`choices` (colunas `combo_id`/`combo_choices`).

Produto excluído que ainda está numa vaga: ao servir o combo (cardápio e painel), ids inexistentes são filtrados; se alguma vaga ficar sem nenhum produto disponível, o cardápio serve o combo com `available: false`.

## 4. Front do cliente

- **Seção "Promoção do dia"** antes das abas de categoria, só quando `combo` não é null: card em destaque (borda dourada, selo "Promoção do dia", foto ou placeholder, nome, descrição, preço, botão "Montar combo"; esgotado → "Esgotado hoje", botão desabilitado).
- **Janela "Montar combo"** (`<dialog>`, mesmo padrão da janela da pizza): uma etapa por vaga; pizza = inteira/meio a meio com só os sabores permitidos + adicionais; bebida = rádio. Preço ao vivo via `shared/pricing.js` (função nova, pura, usada também pelo servidor). "Adicionar" só habilita com todas as vagas preenchidas; esgotados desabilitados.
- **Carrinho** (`barao:cart:v1`, só ids): uma linha por combo com as escolhas em texto menor; − / +. Combo inválido hoje → servidor responde 409 e o fluxo atual de erro de item mostra a mensagem.
- Regras de front de sempre: `el()` sem `innerHTML`, tokens, ≥ 44px, foco preso, Esc, PT-BR.

## 5. Mensagem do WhatsApp

Linha do combo, no padrão atual (3 espaços de recuo, travessão `—`):
```
1x Combo Clássico — R$ 36,90
   • Pizza meio a meio: Calabresa / Mussarela
   + Borda Recheada com Catupiry — R$ 4,50
   • Coca-Cola 1 Litro
   Obs.: sem cebola
```
- `{qtd}x {nome do combo} — {formatBRL(base_unit_cents × quantity)}`.
- Cada escolha: `   • {description}`, na ordem das vagas, sem preço; os adicionais de uma pizza vêm **logo abaixo dela**: `   + {nome} — {formatBRL(priceCents × quantity)}` (assim a cozinha sabe em qual pizza vai a borda quando o combo tem duas).
- `   Obs.: {notes}` por último, só se houver.
- A soma dos valores exibidos no bloco = `line_total_cents`.
- A mensagem regenerada a partir do banco usa `combo_choices`.

## 6. Painel admin

- Aba **"Combos"**: faixa "Hoje aparece: {combo}" ou "Nenhum combo hoje"; lista com foto, nome, preço, dias (ex.: "Ter · Qui"), Esgotado, Editar, Excluir.
- Formulário: nome, descrição, preço (máscara de reais), 7 caixas Dom–Sáb (dia de outro combo desabilitado com o nome dele), vagas (rótulo, tipo, produtos permitidos com atalhos "Marcar todas as Clássicas/Especiais/Bebidas", subir/descer/remover; 1–4 vagas), foto.
- **Pedidos**: item combo mostrado como na mensagem do WhatsApp. **Resumo/Mais vendidos**: combo entra pelo nome.

## 7. Testes
- **Unit**: preço do combo em `shared/pricing.js` (base + adicionais × quantidade); validação de slots no service (número/kind, produto fora da vaga, sabor repetido, 2 bordas); combo de hoje por dia da semana em Fortaleza (relógio injetado, virada de dia); regra de um combo por dia; mensagem do WhatsApp com combo (1 e 2 pizzas, com e sem adicionais, quantidade 2).
- **Integração** (supertest + fakeDb): `GET /api/menu` com e sem combo; `POST /api/orders` com combo válido (201, snapshot) e cada erro da tabela 3.2; CRUD admin, 401/403, dia duplicado, exclusão com pedido → 409; contrato fakeDb × repositório.
- **SQL** (PGlite fora do repo): 0001–0004 aplicadas, `create_order` com combo, constraint `kind_shape`, `on delete restrict`.
- **Manual**: criar combo no painel, ver no dia certo, montar meio a meio com borda, pedir, conferir WhatsApp e painel.

## 8. Deploy
Aplicar `0004_combos.sql` no SQL Editor e rodar `notify pgrst, 'reload schema';` (documentar no `DEPLOY.md`).
