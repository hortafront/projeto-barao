---
name: barao-cardapio-precos
description: Use quando for criar ou alterar shared/money.js, shared/pricing.js ou src/services/pricing.service.js do Barão; quando calcular preço de pizza inteira ou meio a meio, adicionais (borda, catupiry por cima, borda de chocolate), subtotal do carrinho ou do pedido; quando formatar ou converter reais/centavos (formatBRL, parseBRLToCents, R$, troco); quando mexer na tabela/seed do cardápio e seus preços; ou quando planejar múltiplos tamanhos de pizza. Também quando aparecerem palavras como "preço", "centavos", "priceCents", "meio a meio", "addon", "subtotal", "troco".
---

# Barão — Cardápio e regras de preço

Fonte da verdade do preço: **o servidor**, a partir do banco. O front usa o MESMO código (`shared/pricing.js`, servido em `/shared/pricing.js`) só para mostrar o preço ao vivo. Preço enviado pelo cliente é sempre ignorado.

## Regras obrigatórias
1. Dinheiro é **inteiro em centavos** em todo lugar (`price_cents` no banco, `priceCents` no JS/API, `*_cents`/`*Cents` sempre). Nunca `toFixed`, nunca `parseFloat`, nunca somar reais.
2. Formatação só na borda (tela e mensagem do WhatsApp) via `formatBRL(cents)`.
3. Pizza = tamanho único. **1 sabor (inteira) ou exatamente 2 sabores distintos (meio a meio)**, todos `kind = 'pizza'`.
4. **Preço da pizza = preço do sabor mais caro + soma dos adicionais.** Nunca média.
5. Adicionais (`kind = 'addon'`) só em pizza, distintos (cada um no máximo 1x por pizza), somam por pizza.
6. `quantity` inteiro 1–20 por item; 1–30 itens por pedido.
7. Total do item (`lineTotalCents`) = `(sabor mais caro + addons) × quantity` = `unitPriceCents × quantity`. Subtotal = soma dos itens. (Na mensagem do WhatsApp o item aparece em linhas separadas: pizza = `baseUnitCents × qtd`, cada addon = `priceCents × qtd` — ver `barao-pedido-whatsapp`.) **Taxa de entrega não é calculada** ("a combinar").
8. Troco (`payment.method = 'cash'`): `changeForCents` opcional; se informado, **>= subtotal** (o total do pedido, já que não há taxa calculada).
9. `shared/*.js` são ES modules **puros e sem dependências** (nem `node:*`, nem DOM) — rodam no Node e no browser.

## Cardápio (seed `0002_seed_cardapio.sql`)
| Categoria (slug) | kind | Produto | priceCents |
|---|---|---|---|
| classicas | pizza | Mista | 3049 |
| classicas | pizza | Calabresa | 3049 |
| classicas | pizza | Mussarela | 3049 |
| classicas | pizza | Marguerita | 3490 |
| especiais | pizza | Frango | 3499 |
| especiais | pizza | Portuguesa | 3499 |
| especiais | pizza | Bacon | 3999 |
| especiais | pizza | Carne do Sol | 4299 |
| bebidas | drink | Coca-Cola 600ml | 600 |
| bebidas | drink | Coca-Cola 600ml Zero Açúcar | 600 |
| bebidas | drink | Coca-Cola 1 Litro | 1000 |
| bebidas | drink | Coca-Cola 1 Litro Zero Açúcar | 1000 |
| bebidas | drink | Guaraná 1 Litro | 800 |
| adicionais | addon | Borda Recheada com Catupiry | 450 |
| adicionais | addon | Finalize com Catupiry por cima | 450 |
| adicionais | addon | Borda de Chocolate (Garoto ao Leite) | 999 |

Descrições e SQL completos: skill `barao-supabase` → `reference/seed.sql`. Atenção: Marguerita é **3490** (R$ 34,90), não 3499.

## `shared/money.js` (referência completa)
```js
// shared/money.js — ES module puro, sem dependências (Node + browser)
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** 3499 -> "R$ 34,99". Lança TypeError se não for inteiro seguro. */
export function formatBRL(cents) {
  if (!Number.isSafeInteger(cents)) {
    throw new TypeError(`formatBRL: esperado inteiro em centavos, recebido ${cents}`);
  }
  // Intl usa NBSP (U+00A0) depois de "R$"; normaliza para espaço comum
  // para a mensagem do WhatsApp e os testes baterem com o contrato.
  return BRL.format(cents / 100).replace(/ /g, ' ');
}

/**
 * "R$ 1.234,56" -> 123456 | "100" -> 10000 | "50,5" -> 5050 | "50.5" -> 5050
 * Retorna null se inválido/vazio/negativo. Aceita só string (input de formulário).
 */
export function parseBRLToCents(input) {
  if (typeof input !== 'string') return null;
  let s = input.replace(/[\s ]/g, '').replace(/^R\$/i, '');
  if (/^\d+\.\d{1,2}$/.test(s)) s = s.replace('.', ','); // teclado numérico com ponto decimal
  if (!/^(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/.test(s)) return null;
  const [intPart, decPart = ''] = s.replace(/\./g, '').split(',');
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}
```
`cents / 100` dentro de `formatBRL` é aceitável: é só exibição, nunca volta para cálculo.

## `shared/pricing.js` (referência completa)
```js
// shared/pricing.js — ES module puro, sem dependências (Node + browser)
export const LIMITS = Object.freeze({
  minFlavors: 1, maxFlavors: 2, minQuantity: 1, maxQuantity: 20, maxItems: 30,
});

function assertCents(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label}: centavos inválidos (${value})`);
  }
}

function assertQuantity(q) {
  if (!Number.isInteger(q) || q < LIMITS.minQuantity || q > LIMITS.maxQuantity) {
    throw new RangeError(`quantidade inválida (${q}); permitido ${LIMITS.minQuantity}–${LIMITS.maxQuantity}`);
  }
}

/** Preço base da pizza = sabor mais caro. flavors: [{ priceCents }] */
export function calcPizzaBaseCents(flavors) {
  if (!Array.isArray(flavors) || flavors.length < LIMITS.minFlavors || flavors.length > LIMITS.maxFlavors) {
    throw new RangeError('pizza precisa de 1 ou 2 sabores');
  }
  flavors.forEach((f) => assertCents(f?.priceCents, 'sabor'));
  return Math.max(...flavors.map((f) => f.priceCents));
}

/** Unitário = max(preço dos sabores) + soma dos addons. addons: [{ priceCents }] */
export function calcPizzaUnitCents(flavors, addons = []) {
  const base = calcPizzaBaseCents(flavors);
  return addons.reduce((sum, a) => {
    assertCents(a?.priceCents, 'adicional');
    return sum + a.priceCents;
  }, base);
}

/**
 * Total da linha.
 * pizza: { kind: 'pizza', flavors: [{priceCents}], addons: [{priceCents}], quantity }
 * drink: { kind: 'drink', product: { priceCents }, quantity }
 */
export function calcItemCents(item) {
  assertQuantity(item?.quantity);
  let unit;
  if (item.kind === 'pizza') unit = calcPizzaUnitCents(item.flavors, item.addons ?? []);
  else if (item.kind === 'drink') { assertCents(item.product?.priceCents, 'bebida'); unit = item.product.priceCents; }
  else throw new TypeError(`kind de item inválido: ${item.kind}`);
  return unit * item.quantity;
}

export function calcOrderSubtotalCents(items) {
  return items.reduce((sum, item) => sum + calcItemCents(item), 0);
}
```
As funções puras checam forma/limites; **distinção de sabores/addons, `kind` correto e disponibilidade** são checados no servidor (Zod + `pricing.service.js`). O front impede na UI, mas não é autoridade.

## `src/services/pricing.service.js`
Resolve ids → produtos do banco, valida kind/disponibilidade, recalcula e monta o snapshot de cada item. Implementação de referência em [reference/pricing.service.md](reference/pricing.service.md). Funções públicas: `collectProductIds(items)`, `priceOrderItems(items, productsById)`, `assertChangeIsValid(payment, totalCents)`.

## Exemplos numéricos (use como casos de teste)
| Caso | Cálculo | Resultado |
|---|---|---|
| Calabresa inteira | 3049 | 3049 → R$ 30,49 |
| Calabresa / Frango | max(3049, 3499) | 3499 → R$ 34,99 |
| Calabresa / Frango + Borda Catupiry | 3499 + 450 | 3949 → R$ 39,49 |
| Mussarela / Marguerita | max(3049, 3490) | 3490 → R$ 34,90 |
| Bacon / Carne do Sol + Borda Catupiry + Catupiry por cima | 4299 + 450 + 450 | 5199 |
| Frango + Borda de Chocolate, qtd 2 | (3499 + 999) × 2 | 8996 → R$ 89,96 |
| 2x Coca-Cola 1 Litro Zero Açúcar | 1000 × 2 | 2000 → R$ 20,00 |
| Pedido do contrato: (Calabresa/Frango + Borda Catupiry) + 2x Coca 1L Zero | 3949 + 2000 | 5949 → R$ 59,49 |
| Troco para R$ 100,00 num pedido de 5949 | 10000 >= 5949 | ok |
| Troco para R$ 50,00 num pedido de 5949 | 5000 < 5949 | 400 VALIDATION_ERROR |
| Pior caso: 30 itens × 20 × (4299+450+450+999) | 30 × 20 × 6198 | 3.718.800 (cabe folgado em `integer`) |

## Casos de borda / armadilhas
- Meio a meio com o mesmo sabor duas vezes (`[id, id]`) → 400 (não é "inteira").
- 0 ou 3+ sabores → 400. Addon repetido → 400. Addon em bebida → schema rejeita (`addonIds` só existe em item pizza).
- Id de sabor que é `drink`/`addon` (ou addon que é `pizza`) → 400 VALIDATION_ERROR.
- Produto inexistente ou `available = false` → 409 PRODUCT_UNAVAILABLE com `details` listando os itens.
- `Math.max()` de array vazio é `-Infinity` — por isso `calcPizzaBaseCents` valida antes.
- `quantity: 1.5`, `"2"` (string) ou 0 → rejeitar (Zod usa `z.number().int()`).
- Cliente mandando `priceCents`/`subtotalCents` no body: Zod descarta chaves desconhecidas; nunca leia esses campos.
- `formatBRL(34.99)` lança erro de propósito — sinal de que alguém converteu para reais no meio do caminho.
- Comparar strings de `formatBRL` em teste: o NBSP já é normalizado para espaço comum.
- Carrinho em `localStorage` (`barao:cart:v1`) guarda só ids e quantidades; preço sempre vem de `GET /api/menu`.

## Evoluir para múltiplos tamanhos (sem quebrar)
- Banco (nova migration `0003_tamanhos.sql`): tabela `product_prices (product_id uuid fk, size text, price_cents int, primary key (product_id, size))`; manter `products.price_cents` como preço do tamanho padrão `'unico'` até migrar o front.
- API: item pizza ganha `size` opcional com default `'unico'`; `order_items` ganha `size_label text null`.
- `shared/pricing.js` **não muda de assinatura**: o service resolve `priceCents` de cada sabor/addon **para o tamanho escolhido** antes de chamar `calcPizzaUnitCents(flavors, addons)`. A regra "sabor mais caro" continua valendo por tamanho.
- Mensagem: descrição vira `Pizza G meio a meio: ...` só quando `size !== 'unico'`, preservando o formato atual.

## Checklist final
- [ ] Nenhum float/`toFixed`/`parseFloat` em dinheiro; nomes terminam em `Cents`.
- [ ] `shared/money.js` e `shared/pricing.js` sem imports; mesmos arquivos usados por servidor e browser.
- [ ] Meio a meio = sabor mais caro; addons somam por pizza e multiplicam pela quantidade.
- [ ] Servidor recalcula tudo a partir do banco; testes unitários cobrem a tabela de exemplos acima.
- [ ] Troco validado contra o subtotal; erro em PT-BR amigável.
