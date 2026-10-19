# Painel admin — telas de referência

Arquivos: `public/admin/index.html` (login), `public/admin/painel.html` (painel com abas), `public/admin/js/`:
`auth.js`, `admin-api.js` (ver `auth-e-api.js`), `painel.js` (boot + navegação), `products.js`, `hours.js`,
`store.js`, `orders.js`, `summary.js`. DOM via `el()` de `/js/dom.js` (mesmo helper do cliente).
CSS: `/css/tokens.css` + `/css/base.css` + `/css/admin.css`; `<body class="theme-admin">`.

Navegação: barra inferior fixa com 5 abas (Pedidos · Produtos · Horários · Loja · Resumo), ícone + rótulo,
altura 56px + safe-area. Aba inicial: **Pedidos** (o que o dono mais olha no expediente). Hash na URL
(`#pedidos`, `#produtos`…) para o botão voltar funcionar.

## Login (`/admin/`)
- Campos e-mail (`autocomplete="username"`) e senha (`autocomplete="current-password"`), botão "Entrar" 48px.
- `?motivo=sessao` → "Sua sessão expirou. Entre novamente." · `?motivo=acesso` → "Este e-mail não tem acesso ao painel."
- Erro de login genérico: "E-mail ou senha inválidos." Botão desabilitado durante a tentativa.
- `<meta name="robots" content="noindex">` em todas as páginas do admin.

## Pedidos
- Topo: filtro De/Até (`<input type="date">`), padrão = hoje em `America/Fortaleza`; atalhos "Hoje", "Ontem", "7 dias".
- `GET /api/admin/orders?from&to&page` → `{ orders, page, pageSize, total }` → lista de cartões: código `BR-0427` (display), hora local, nome, Entrega/Retirada, pagamento, subtotal, selo de status.
- Selos: `received` "Recebido" (dourado), `confirmed` "Confirmado" (verde), `canceled` "Cancelado" (tijolo, texto riscado no valor).
- Paginação "Carregar mais". Botão "Atualizar" (sem polling automático no MVP).
- Detalhe (`GET /api/admin/orders/:id` → `{ order }`, com `order.items`): itens (descrição, sabores, addons `[{ name, priceCents }]`, obs., qtd, total da linha), endereço/referência, telefone como link `tel:` e botão "Abrir conversa" `https://wa.me/55<telefone>`, troco, observações.
- Ações: "Confirmar" (`PATCH .../status { status: 'confirmed' }`) e "Cancelar" (confirmação obrigatória). Status final não volta para `received`.

## Produtos
- `GET /api/admin/products` → `{ products }`, agrupado por categoria (ordem `sort_order`). Linha: foto 56px, nome, preço, toggle **Disponível/Esgotado** grande (switch 44px, `role="switch" aria-checked`).
- Toggle = `PATCH /api/admin/products/:id/availability { available }` otimista: muda na hora, reverte e avisa se falhar.
- "Novo produto" e toque na linha → formulário: categoria (select), tipo derivado da categoria (`classicas|especiais`→pizza, `bebidas`→drink, `adicionais`→addon), nome (1–80), descrição (≤ 300), preço em reais, ordem (0–9999), disponível — limites do `product.schema.js` (skill barao-api-express).
- Só quando o tipo é `addon`: campo **"Grupo: Borda | nenhum"** (`<select name="addonGroup">` ou 2 radios) → envia `addonGroup: 'borda'` ou `null`. Ajuda: "Adicionais do grupo Borda são exclusivos: o cliente escolhe no máximo uma borda por pizza." Para pizza/bebida o campo fica oculto e o form envia `addonGroup: null`. Sempre enviar `kind` junto (o schema só aceita grupo em addon → 400 com `path: 'addonGroup'`). Na lista, mostrar um selo pequeno "Borda" nos addons do grupo.
- Foto: `<input type="file" accept="image/jpeg,image/png,image/webp">`, valida tipo e ≤ 2 MB no front, preview com `URL.createObjectURL`, envio `POST /api/admin/products/:id/image` (campo `image`) só depois de o produto existir (criar → depois enviar foto).
- Excluir: confirmação; 204 → some da lista. Se a API responder 409 `PRODUCT_HAS_ORDERS` → mostrar a mensagem da API ("Produto já tem pedidos; marque como esgotado em vez de excluir") com botão "Marcar como esgotado" que faz o `PATCH .../availability { available: false }`.

## Horários
- 7 linhas Domingo → Sábado (`weekday` 0..6, 0 = domingo): checkbox "Fechado", `<input type="time">` abre / fecha.
- Seed (dias confirmados pelo dono): terça e quarta vêm com "Fechado" marcado; demais 18:00–23:30 (horário provisório — o dono ajusta aqui).
- Se fecha ≤ abre: mostrar dica "Vira a meia-noite: fecha às 00:30 do dia seguinte" (válido, não é erro). Abre = fecha → erro.
- Botão "Copiar para todos os dias" a partir da linha de domingo. Um único "Salvar horários" → `PUT /api/admin/hours` com os 7 dias.
- Rodapé informativo: "Horário de Fortaleza (UTC−3)".

## Loja
- Mostra o estado atual vindo de `GET /api/status` (aberta/fechada + motivo) em selo grande.
- 3 opções grandes (radio cards): **Automático (segue horários)** · **Forçar aberta** · **Forçar fechada**.
- Trocar para `open`/`closed` pede confirmação com texto explícito ("Os clientes NÃO conseguirão fazer pedidos até você voltar para Automático."). `PUT /api/admin/settings { storeOverride }`.
- Override ativo fica destacado também no topo do painel (faixa tijolo "Loja forçada FECHADA") para não esquecer.

## Resumo
- Mesmo filtro de datas (padrão hoje). `GET /api/admin/reports/summary?from&to`.
- 3 blocos: Pedidos (`ordersCount`), Faturamento bruto estimado (`formatBRL(grossCents)`, nota "sem taxa de entrega; exclui pedidos cancelados" — regra da rpc `orders_summary`, skill barao-supabase), Itens mais vendidos (lista ordenada `name` × `quantity`, até 10).
- Sem gráfico no MVP; números grandes, legíveis à distância.
