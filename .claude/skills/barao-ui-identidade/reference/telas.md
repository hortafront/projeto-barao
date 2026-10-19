# Telas do cliente — especificação de referência (public/index.html)

Mobile-first (360px de largura é o alvo base). Todo texto em PT-BR. Valores vêm de `tokens.css`.

## Esqueleto do index.html

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#0F3D2E">
  <title>Barão – Delivery de Pizza</title>
  <meta name="description" content="Peça agora e saboreie! Cardápio da Barão – Delivery de Pizza em Fortaleza.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Oswald:wght@500;600;700&family=Pacifico&display=swap">
  <link rel="stylesheet" href="/css/tokens.css">
  <link rel="stylesheet" href="/css/base.css">
  <link rel="stylesheet" href="/css/menu.css">
  <link rel="stylesheet" href="/css/cart.css">
  <link rel="modulepreload" href="/shared/pricing.js">
  <script type="module" src="/js/app.js"></script>
</head>
<body>
  <a class="skip-link" href="#menu">Pular para o cardápio</a>
  <header class="site-header">
    <img class="site-header__logo" src="/img/logo-barao.webp" width="120" height="48" alt="Barão – Delivery de Pizza">
    <span class="status-badge" id="store-status" role="status">Verificando…</span>
  </header>
  <div class="store-closed-banner" id="store-closed" hidden></div>
  <nav class="category-tabs" id="category-tabs" aria-label="Categorias do cardápio"></nav>
  <main id="menu" class="menu" aria-busy="true"></main>

  <div class="cart-bar" id="cart-bar" hidden>
    <button type="button" class="cart-bar__button" id="cart-open" aria-controls="cart-drawer">
      <span id="cart-count">0 itens</span>
      <span>Ver carrinho</span>
      <span class="price" id="cart-total" aria-live="polite">R$ 0,00</span>
    </button>
  </div>

  <dialog id="product-modal" class="modal" aria-labelledby="product-modal-title"></dialog>
  <dialog id="cart-drawer" class="drawer" aria-labelledby="cart-title"></dialog>
  <dialog id="checkout-modal" class="modal modal--full" aria-labelledby="checkout-title"></dialog>
  <div id="toast" class="toast" role="alert" aria-live="assertive"></div>
</body>
</html>
```

Nada de `onclick=""` inline nem `<script>` inline (CSP do helmet permite só `self`).

## Header
- Fundo `--color-bg-deep`, altura `--header-h`, `position: sticky; top: 0; z-index: var(--z-sticky)`.
- Logo à esquerda; selo à direita:
  - Aberto: fundo `--color-open`, texto `--color-open-contrast`, "ABERTO AGORA".
  - Fechado: fundo `--color-danger`, texto `--color-danger-contrast`, "FECHADO" + abaixo, no banner, "Abrimos hoje às 18:00" (de `nextOpenAt`, formatado em `America/Fortaleza`).
  - Sempre texto + cor (nunca só cor).
- Slogan "Peça agora e saboreie!" em `--font-script` dourado, só no topo da página (não no header sticky).

## Abas de categoria
- `position: sticky; top: var(--header-h)`; `overflow-x: auto; scroll-snap-type: x proximity; scrollbar-width: none`.
- Cada aba é `<a href="#cat-classicas">` (funciona sem JS), altura ≥ 44px, `--font-display` caixa alta.
- Aba ativa: sublinhado dourado 2px + `aria-current="true"`; atualizar via `IntersectionObserver` nas seções.
- Ao ativar, `tab.scrollIntoView({ inline: 'center', block: 'nearest' })` (respeita reduced-motion via CSS).
- Seções com `scroll-margin-top: calc(var(--header-h) + var(--tabs-h))`.
- Categoria `adicionais` NÃO vira aba nem lista de cards: addons só aparecem dentro do modal da pizza.

## Card de produto
```
┌───────────────────────────────────────────┐  ← moldura: --border-frame + --frame-inset
│ [foto 88×88]  NOME DO PRODUTO (display)   │
│               descrição em creme (2–3 l.) │
│               R$ 30,49          [ + ]     │  ← botão 44×44, aria-label="Adicionar Mista"
└───────────────────────────────────────────┘
```
- `<article class="product-card">` com `<h3>` do nome. Imagem: `loading="lazy" decoding="async" width height` + `alt=""` (decorativa: nome já está no texto). **Sem `imageUrl` (estado atual de todos os produtos: o dono ainda vai enviar as fotos)** → placeholder em SVG inline na identidade, nunca `<img>` quebrada: `<svg><use href="#ph-pizza">` (pizza) ou `#ph-drink` (garrafa), símbolos definidos num `<svg hidden>` do `index.html`; fundo `var(--color-surface-hover)`, traço/ornamento `var(--color-accent)`, moldura fina como o resto do card; 88×88, `aria-hidden="true"`. Foto que falhar ao carregar (`error`) cai no mesmo placeholder. O layout do card é idêntico com ou sem foto.
- Pizza: clique no card/botão abre o modal. Bebida: botão adiciona direto (quantidade 1) + toast "Coca-Cola 600ml adicionada".
- Esgotado (`available=false`): card com `opacity` reduzida, foto em `grayscale`, selo "ESGOTADO" (tijolo), botão `disabled` com `aria-label="Mista esgotada"`. Continua visível (cliente sabe que existe).
- Loja fechada: cards visíveis; botão adicionar habilitado (pode montar), mas checkout bloqueado com aviso.

## Modal da pizza (`<dialog>` em tela cheia no mobile, centralizado ≥ 768px)
1. Título = sabor clicado. Descrição.
2. Segmento `Inteira | Meio a meio` (`<fieldset>` com 2 radios estilizados, 44px).
3. Se meio a meio: lista de radios do 2º sabor (só pizzas disponíveis, exceto o 1º). Mostrar o preço de cada uma + nota "Meio a meio cobra o sabor de maior valor".
4. Adicionais (só os disponíveis), agrupados por `addonGroup` com `splitAddons()` de `cart.js`:
   - **Borda** (`addonGroup = 'borda'`): `<fieldset><legend>Borda</legend>` com **radios** `name="addon-group:borda"` — "Sem borda" (value `""`, marcado por padrão) / "Borda Recheada com Catupiry +R$ 4,50" / "Borda de Chocolate (Garoto ao Leite) +R$ 9,99". No máximo uma borda por pizza: o radio torna impossível marcar duas.
   - **Sem grupo**: checkbox `name="addon"` — "Finalize com Catupiry por cima +R$ 4,50" (combina com qualquer borda ou com "Sem borda").
   - Se uma borda estiver esgotada, o radio dela some (ou fica `disabled` com "Esgotado"); se o grupo inteiro esgotar, o fieldset some.
5. Observação: `<textarea maxlength="140">` ("Ex.: sem cebola").
6. Quantidade: `−` `1` `+` (1..20), botões 44px com aria-label.
7. Rodapé sticky: botão dourado "Adicionar · R$ 34,99" — valor ao vivo recalculado com `shared/pricing.js` a cada `change`; o valor fica num `<span aria-live="polite">`.
- Botão adicionar fica `disabled` se meio a meio sem 2º sabor.

## Barra do carrinho
- `position: fixed; inset: auto 0 0 0; z-index: var(--z-cartbar)`, altura `--cartbar-h` + `env(safe-area-inset-bottom)`.
- Some com carrinho vazio. `main` recebe `padding-bottom` para o último card não ficar escondido.

## Drawer do carrinho (`<dialog class="drawer">`, desliza de baixo)
- Lista: descrição (`describeLine`), addons em linha menor, obs., stepper de quantidade, "Remover", total da linha.
- Subtotal + "_Taxa de entrega a combinar_" (só se entrega escolhida depois; aqui mostrar como nota geral).
- Botão "Finalizar pedido" (desabilitado com loja fechada, com texto explicando).
- Vazio: ilustração/ornamento + "Seu carrinho está vazio" + botão "Ver cardápio".

## Checkout (`<dialog class="modal modal--full">`, `<form novalidate>` + validação própria)
| Campo | Regra no front | Envio |
|---|---|---|
| Nome | `required minlength=2 maxlength=60 autocomplete="name"` | `customer.name` trim |
| Telefone | `type="tel" inputmode="numeric" autocomplete="tel-national"`, máscara `(85) 99999-9999` | `customer.phone` só dígitos (10–11) |
| Entrega/Retirada | radios `delivery`/`pickup` | `fulfillment` |
| Endereço | visível + required só com `delivery`: Rua, Número, Bairro, Referência (opcional) | `address` (omitir no pickup) |
| Pagamento | radios Pix / Dinheiro / Cartão (maquininha). Com **Pix** marcado, mostrar abaixo a nota "A chave Pix será enviada pelo WhatsApp após o pedido" (o site **não exibe chave Pix**) | `payment.method` |
| Troco para | só com `cash`, opcional, `inputmode="decimal"`, `parseBRLToCents`, ≥ subtotal | `payment.changeForCents` |
| Observações | `maxlength=280` | `notes` |

- Erros: mensagem abaixo do campo (`aria-describedby`, `aria-invalid="true"`), foco no 1º inválido.
- Botão "Enviar pedido" → estado "Enviando…" `disabled` (evita pedido duplicado).
- Respostas: 201 → confirmação; 400 `VALIDATION_ERROR` → mapear `details` para campos; 409 `STORE_CLOSED` → banner fechado; 409 `PRODUCT_UNAVAILABLE` → recarregar menu, `revalidate`, voltar ao drawer com aviso; 429 `RATE_LIMITED` → "Muitas tentativas, aguarde alguns minutos"; rede → "Sem conexão. Seu carrinho foi mantido."

## Confirmação
- Ornamento + "Pedido recebido!" (script) + código grande `BR-0427` (`--fs-3xl`, display, dourado).
- Instrução: "Toque no botão para enviar o pedido pelo WhatsApp. O pedido só é confirmado pela loja no WhatsApp."
- Se o pagamento for Pix: repetir o aviso "A chave Pix será enviada pelo WhatsApp após o pedido".
- Botão primário `<a href="{whatsappUrl}" rel="noopener">Abrir WhatsApp</a>` (criado com `el()`).
- Ao receber o 201: limpar carrinho → renderizar esta tela → `window.location.href = whatsappUrl` (mesma aba, não é bloqueado). Nunca `window.open` depois de `await`. O botão serve de fallback para quem voltar.
- Botão secundário "Fazer novo pedido".

## Estados globais
| Estado | Exibição |
|---|---|
| Carregando menu | 3–4 cards skeleton (blocos `--color-surface` com shimmer desligado em reduced-motion); `aria-busy="true"` no `main` |
| Erro de rede no menu | Mensagem + botão "Tentar novamente" (refaz `getMenu`) |
| Loja fechada | Selo "FECHADO", banner com próximo horário, checkout bloqueado |
| Produto esgotado | Ver card; removido do carrinho no `revalidate` com toast listando nomes |
| Carrinho vazio | Barra oculta; drawer com estado vazio |

## Direção estética — "pizzaria tradicional rústica premium"
- Fundo verde com `background-image: var(--texture-noise)` (ruído 5%) — textura, não estampa.
- Molduras: 1px dourado + inset fino (dupla linha) só em cards, modal e confirmação. Cantos `--radius-md`.
- Ornamentos: divisor de seção = linha dourada fina com losango/estrela central em SVG inline (`aria-hidden="true"`). No máximo 1 ornamento por seção.
- Títulos de seção: `--font-display` caixa alta dourado, com o nome em script por cima apenas no hero ("Pizzas" script + "CLÁSSICAS" display).
- Brilho de forno (`--shadow-glow`) só no botão primário em foco/hover e no código do pedido.
- Mascote (chef de bigode na lambreta vermelha) só no hero e na confirmação, em webp ≤ 40 KB.
- Evitar: gradientes chamativos, mais de 2 fontes por bloco, ícones coloridos, texto dourado pequeno sobre foto.
