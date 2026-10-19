---
name: barao-ui-identidade
description: Use quando for criar ou alterar o front do cliente do cardápio Barão — public/index.html, public/css/*.css (tokens.css, base.css, menu.css, cart.css), public/js/*.js (app.js, api.js, cart.js, menu.js, product-modal.js, checkout.js, dom.js) — ou ao mexer em identidade visual, cores verde/dourado/creme/tijolo, fontes, cards de produto, modal da pizza (inteira/meio a meio), carrinho, localStorage barao:cart:v1, checkout, tela de confirmação/WhatsApp, estados vazio/erro/fechado/esgotado, acessibilidade ou performance mobile.
---

# Barão — UI do cliente e identidade visual

Front vanilla (HTML/CSS/JS ESM nativo, sem bundler, sem framework, sem libs) servido de `public/`.
O cliente monta o pedido, a API valida/salva e devolve `whatsappUrl`; o front só abre o link.
Contrato de nomes/rotas: `CLAUDE.md`. Preço: skill `barao-cardapio-precos`. Payload: skill `barao-pedido-whatsapp`.

## Referências (leia a que for usar)
- [reference/tokens.css](reference/tokens.css) — design tokens completos → copiar para `public/css/tokens.css`.
- [reference/dom.js](reference/dom.js) — `el()`, `render()`, `announce()`, `openDialog()` → `public/js/dom.js`.
- [reference/cart.js](reference/cart.js) — carrinho `barao:cart:v1`, revalidação, preço via `/shared/pricing.js`.
- [reference/telas.md](reference/telas.md) — esqueleto do `index.html`, cada tela, estados e direção estética.

## Regras obrigatórias
1. **Nunca `innerHTML`/`insertAdjacentHTML`/`outerHTML` com dados.** Todo DOM dinâmico via `el(tag, attrs, ...children)` de `dom.js` (strings viram nós de texto).
2. **Dinheiro em centavos inteiros.** Formatar só na borda com `formatBRL(cents)` de `/shared/money.js`; entrada em reais (troco) com `parseBRLToCents`. Nada de `price / 100`, `toFixed`, `parseFloat` em valor.
3. **Preço ao vivo = `/shared/pricing.js`** (mesmo código do servidor). Nunca reimplementar regra (meio a meio = sabor mais caro; addons somam por pizza, 1x cada; **no máximo uma borda por pizza** — addons com o mesmo `addonGroup` são radio, sem grupo são checkbox).
4. **Carrinho** em `localStorage['barao:cart:v1']` guarda só ids/quantidades/opções/obs. Ao carregar o menu, sempre `revalidate(productsById)`; preços e nomes vêm do `/api/menu`. O servidor ignora preço do cliente — não envie.
5. **Só tokens**: cores, fontes, espaços, raios, sombras, z-index vêm de `var(--*)`. Nenhum hex fora de `tokens.css`.
6. **Mobile-first**: CSS base para 360px; `@media (min-width: 768px)` para ampliar. Sem scroll horizontal de página (só nas abas).
7. **Acessibilidade**: `lang="pt-BR"`; contraste AA (corpo em creme, dourado só em títulos/preços/CTA); alvos ≥ 44px (`--tap-min`); `:focus-visible` com contorno `--color-focus`; modais com `<dialog>.showModal()` (foco preso + Esc) e foco devolvido; total em `aria-live="polite"`; estados nunca só por cor; `prefers-reduced-motion` respeitado.
8. **Performance**: imagens `.webp` com `loading="lazy" decoding="async" width height`; Google Fonts com `display=swap` e `preconnect`; zero dependências; nenhum `<script>`/`style=""` inline (CSP `self`).
9. **Categoria `adicionais`** não aparece como seção: addons só no modal da pizza.

## Módulos (`public/js/`)
| Arquivo | Responsabilidade |
|---|---|
| `app.js` | boot: carrega `getStatus()` + `getMenu()` em paralelo, `indexMenu`, `revalidate`, renderiza, liga eventos |
| `api.js` | `fetch` para `/api/*`, converte erro em `ApiError` |
| `dom.js` | helpers de DOM seguros |
| `cart.js` | estado do carrinho, persistência, preço por linha |
| `menu.js` | abas sticky, seções, cards, estados carregando/erro/esgotado |
| `product-modal.js` | modal da pizza (inteira/meio a meio, addons, obs., quantidade, preço ao vivo) |
| `checkout.js` | drawer → formulário → POST → confirmação com botão WhatsApp |

### api.js (referência)
```js
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    Object.assign(this, { status, code, details });
  }
}

async function request(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Sem conexão. Verifique sua internet e tente de novo.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.code ?? 'INTERNAL', err.message ?? 'Algo deu errado. Tente novamente.', err.details);
  }
  return data;
}

export const getMenu = () => request('/api/menu');
export const getStatus = () => request('/api/status');
export const createOrder = (payload) => request('/api/orders', { method: 'POST', body: payload });
```

### Card de produto (menu.js)
```js
import { el } from './dom.js';
import { formatBRL } from '/shared/money.js';

export function productCard(product, { onOpenPizza, onAddDrink }) {
  const soldOut = !product.available;
  const action = product.kind === 'pizza' ? () => onOpenPizza(product) : () => onAddDrink(product);
  return el('article', { class: `product-card${soldOut ? ' is-soldout' : ''}` },
    el('img', { class: 'product-card__img', src: product.imageUrl ?? '/img/pizza-placeholder.webp',
      alt: '', width: 88, height: 88, loading: 'lazy', decoding: 'async' }),
    el('div', { class: 'product-card__body' },
      el('h3', { class: 'product-card__name' }, product.name),
      product.description && el('p', { class: 'product-card__desc' }, product.description),
      el('div', { class: 'product-card__footer' },
        el('span', { class: 'price' }, formatBRL(product.priceCents)),
        soldOut && el('span', { class: 'badge badge--soldout' }, 'Esgotado'),
        el('button', { type: 'button', class: 'btn-icon', disabled: soldOut, onclick: action,
          'aria-label': soldOut ? `${product.name} esgotado` : `Adicionar ${product.name}` }, '+'))));
}
```

### Preço ao vivo no modal (product-modal.js)
```js
// form: <form id="pizza-form"> com radios name="mode" (whole|half), name="second",
// radios name="addon-group:borda" (value "" = "Sem borda", default) e checkboxes name="addon" (addons sem grupo).
// Montagem: splitAddons(addons) de cart.js → cada grupo um <fieldset><legend>Borda</legend> de radios; `free` = checkboxes.
function readSelection(form, firstFlavorId) {
  const data = new FormData(form);
  const half = data.get('mode') === 'half';
  const second = data.get('second');
  const groupPicks = [...data.keys()]
    .filter((k, i, all) => k.startsWith('addon-group:') && all.indexOf(k) === i)
    .map((k) => data.get(k))
    .filter(Boolean); // "" = "Sem borda"
  return {
    kind: 'pizza',
    flavorIds: half && second ? [firstFlavorId, second] : [firstFlavorId],
    addonIds: [...groupPicks, ...data.getAll('addon')], // radio garante 1 por grupo
    quantity: Number(data.get('quantity')) || 1,
    notes: String(data.get('notes') ?? '').trim(),
    incomplete: half && !second,
  };
}

form.addEventListener('change', update);
form.addEventListener('input', update);
function update() {
  const { incomplete, ...line } = readSelection(form, product.id);
  submitBtn.disabled = incomplete;
  livePrice.textContent = formatBRL(lineTotalCents(line, productsById)); // span aria-live="polite"
}
```

### Máscara de telefone e payload (checkout.js)
```js
export const onlyDigits = (s) => String(s).replace(/\D/g, '');
export function maskPhone(value) {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : '';
  const rest = d.slice(2);
  const split = d.length === 11 ? 5 : 4;
  return `(${d.slice(0, 2)}) ${rest.slice(0, split)}${rest.length > split ? '-' + rest.slice(split) : ''}`;
}

function buildPayload(f, subtotal) { // f = FormData do checkout
  const fulfillment = f.get('fulfillment');
  const method = f.get('payment');
  const changeRaw = method === 'cash' ? String(f.get('changeFor') ?? '').trim() : '';
  const change = changeRaw ? parseBRLToCents(changeRaw) : null; // parseBRLToCents: null se inválido
  if (changeRaw && change === null) throw new FieldError('changeFor', 'Valor inválido. Ex.: 100 ou 100,00');
  if (change !== null && change < subtotal) throw new FieldError('changeFor', 'O troco deve ser maior ou igual ao total.');
  return {
    customer: { name: f.get('name').trim(), phone: onlyDigits(f.get('phone')) },
    fulfillment,
    ...(fulfillment === 'delivery' && { address: {
      street: f.get('street').trim(), number: f.get('number').trim(),
      district: f.get('district').trim(), reference: f.get('reference').trim() } }),
    payment: { method, ...(change !== null && { changeForCents: change }) },
    ...(f.get('notes').trim() && { notes: f.get('notes').trim() }),
    items: toOrderItems(),
  };
}
```
`FieldError` é uma classe local (`{ field, message }`) para pôr a mensagem sob o campo. Depois do 201 (fluxo da skill `barao-pedido-whatsapp`): `clear()` o carrinho → renderizar a confirmação (código + `el('a', { href: whatsappUrl, rel: 'noopener', class: 'btn btn--primary' }, 'Abrir WhatsApp')`) → `window.location.href = whatsappUrl` (mesma aba; não é bloqueado). **Nunca** `window.open` depois de `await` (vira popup bloqueado). O link fica como fallback para quem voltar à aba.

## Armadilhas
- Backdrop do `<dialog>`: o `click` com `event.target === dialog` só funciona se o `<dialog>` tiver `padding: 0` e um wrapper interno com o conteúdo.
- `position: sticky` quebra se algum ancestral tiver `overflow: hidden`. Trave o scroll do fundo com `body.is-locked { overflow: hidden }` só enquanto o modal está aberto.
- Barra fixa no iPhone: somar `env(safe-area-inset-bottom)` e dar `padding-bottom` ao `main`.
- `input` com `font-size < 16px` dá zoom no iOS — use `--fs-md`.
- Não confiar no relógio do celular para "aberto/fechado": use `GET /api/status`; o servidor decide (409 `STORE_CLOSED`).
- `localStorage` pode lançar (Safari privado) — sempre `try/catch` (já em `cart.js`).
- Duplo toque em "Enviar pedido" cria 2 pedidos: desabilite o botão até a resposta.
- `PRODUCT_UNAVAILABLE` no POST: recarregar `/api/menu`, `revalidate`, avisar quais itens saíram.
- Fonte script (Pacifico) só em 1–3 palavras de destaque; nunca em preço, botão ou parágrafo.

## Checklist final
- [ ] `grep -rn "innerHTML\|insertAdjacentHTML" public/js` vazio (exceto o `throw` do `dom.js`).
- [ ] Nenhum hex fora de `css/tokens.css`; nenhum `parseFloat`/`toFixed` em dinheiro.
- [ ] Preço no modal/drawer bate com o `subtotalCents` devolvido pela API.
- [ ] Carrinho sobrevive a reload; item esgotado no admin some do carrinho com aviso.
- [ ] Payload do checkout = body de `POST /api/orders` do contrato (sem preço, telefone só dígitos, `address` só em entrega).
- [ ] Meio a meio exige 2º sabor distinto; addons 1x cada; bordas em radio ("Sem borda" default, nunca duas); Catupiry por cima em checkbox; quantidade 1..20.
- [ ] Endereço só obrigatório em entrega; troco só em dinheiro e ≥ total.
- [ ] Estados: carregando, erro de rede com "Tentar novamente", loja fechada, esgotado, carrinho vazio.
- [ ] Teclado: Tab percorre tudo com foco visível; Esc fecha modais; foco volta ao botão de origem.
- [ ] 360px sem scroll horizontal; alvos ≥ 44px; reduced-motion sem animação.
- [ ] Lighthouse mobile ≥ 90 (Performance, Acessibilidade, Boas práticas).
