---
name: barao-painel-admin
description: Use quando for criar ou alterar o painel do dono em /admin do cardápio Barão — public/admin/index.html (login), public/admin/painel.html, public/admin/js/*.js, public/css/admin.css — ou tarefas de login com supabase-js/ANON key, token Bearer, sessão expirada, helper adminApi, telas de Produtos (criar/editar, grupo de adicional Borda/addonGroup, upload de foto, toggle Esgotado, preço em reais), Horários (turno que vira a meia-noite), Loja (override auto/aberta/fechada e número do WhatsApp da loja com máscara (85) 99999-9999), Pedidos (filtro por data, status received/confirmed/canceled) e Resumo (faturamento, top itens).
---

# Barão — Painel admin (`/admin`)

Painel usado **no celular do dono, durante o expediente**: poucos toques, botões grandes, feedback claro de "salvo".
Mesma identidade do site (tokens de `barao-ui-identidade`) em tom sóbrio: `<body class="theme-admin">`.
Rotas e formatos da API: skill `barao-api-express` (autoridade). Validação de verdade é no servidor (Zod).

## Referências
- [reference/auth-e-api.js](reference/auth-e-api.js) — `getSupabase()`, `login()`, `logout()`, `requireSession()`, `adminApi()`, `withSaving()`.
- [reference/telas-admin.md](reference/telas-admin.md) — layout e comportamento de cada tela.

## Regras obrigatórias
1. **supabase-js só para autenticação**, importado de `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm` com a **ANON key**; usar apenas `signInWithPassword`, `getSession`, `refreshSession`, `signOut`. Nunca `supabase.from(...)`/`storage` no browser. Nunca a service role no front.
2. **Token**: sessão do supabase-js em `sessionStorage` (chave `barao-admin-auth`), nunca `localStorage`. Toda chamada vai para a API Express com `Authorization: Bearer <access_token>` via `adminApi()`.
3. **401** → um `refreshSession()` e repete; falhou → `logout('sessao')` → login. **403** (e-mail fora de `ADMIN_EMAILS`) → `logout('acesso')`.
4. **Dinheiro**: dono digita em reais (`"34,99"`); converter com `parseBRLToCents` de `/shared/money.js` e enviar `priceCents` inteiro. Exibir com `formatBRL`. Nunca `parseFloat`/`* 100`.
5. **DOM seguro**: `el()` de `/js/dom.js`; nada de `innerHTML` com dados (nome de cliente, observação e endereço vêm de usuários anônimos — XSS no painel é o pior caso).
6. **Ações destrutivas ou que param vendas** (excluir produto, cancelar pedido, forçar loja fechada/aberta) pedem confirmação explícita com o efeito escrito. Usar `<dialog>` próprio (não `confirm()` nativo, feio e bloqueável).
7. **Feedback de salvamento** em toda escrita: botão "Salvando…" desabilitado → toast "Salvo ✓" ou erro legível (`withSaving`). Nunca falha silenciosa.
8. **Mobile**: alvos ≥ 48px no painel, inputs `font-size ≥ 16px`, navegação por barra inferior, nada de tabelas largas (cartões em coluna).
9. Datas/horas exibidas e filtros calculados em `America/Fortaleza`.
10. Páginas com `<meta name="robots" content="noindex">`; nenhum `<script>` inline (CSP).

## Configuração do cliente Supabase
URL e ANON key são buscadas de `GET /api/admin-config` → `{ supabaseUrl, supabaseAnonKey }` (rota pública, fora do
`requireAdmin`, lê `SUPABASE_URL`/`SUPABASE_ANON_KEY` do env). A CSP precisa liberar `script-src https://cdn.jsdelivr.net`
e `connect-src 'self' <SUPABASE_URL>` nas páginas do admin (o login fala direto com o Auth do Supabase).

## Trechos de referência

### Preço em reais → centavos (products.js)
```js
import { parseBRLToCents, formatBRL } from '/shared/money.js';

function readPrice(input, errorEl) {
  const cents = parseBRLToCents(input.value); // "34,99" | "R$ 34,99" | "34" → 3499 | 3400; inválido → null
  if (!Number.isInteger(cents) || cents < 0) {
    errorEl.textContent = 'Preço inválido. Ex.: 34,99';
    input.setAttribute('aria-invalid', 'true');
    return null;
  }
  input.removeAttribute('aria-invalid');
  errorEl.textContent = '';
  input.value = formatBRL(cents).replace(/^R\$\s?/, ''); // normaliza o que foi digitado
  return cents;
}
```

### Toggle Esgotado otimista
```js
async function toggleAvailability(product, switchEl) {
  const next = !product.available;
  switchEl.setAttribute('aria-checked', String(next));
  try {
    await adminApi(`/api/admin/products/${product.id}/availability`, { method: 'PATCH', body: { available: next } });
    product.available = next;
    toast(next ? `${product.name} disponível` : `${product.name} marcado como esgotado`, 'success');
  } catch (err) {
    switchEl.setAttribute('aria-checked', String(product.available)); // reverte
    toast(err.message, 'error');
  }
}
```

### Upload de foto com preview e limite 2 MB
```js
const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
let previewUrl = null;

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  if (!TYPES.includes(file.type)) return fail('Use foto JPG, PNG ou WEBP.');
  if (file.size > MAX_BYTES) return fail('A foto passa de 2 MB. Tire um print ou reduza a imagem.');
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  previewImg.src = previewUrl;
});

async function uploadImage(productId, button) {
  const form = new FormData();
  form.append('image', fileInput.files[0]); // campo exato: image
  return withSaving(button, () =>
    adminApi(`/api/admin/products/${productId}/image`, { method: 'POST', body: form }), { toast });
}
```

### Data de hoje em Fortaleza (filtros)
```js
export const todayInFortaleza = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza' }).format(date); // "2026-10-18"

export const formatTimeFortaleza = (iso) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', hour: '2-digit', minute: '2-digit' })
    .format(new Date(iso));
```

### Horários: turno que vira a meia-noite
```js
// "HH:MM" → minutos; fecha <= abre significa que fecha no dia seguinte (válido).
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
function describeShift({ opensAt, closesAt, isClosed }) {
  if (isClosed) return 'Fechado';
  if (opensAt === closesAt) return null; // inválido → mostrar erro
  return toMin(closesAt) <= toMin(opensAt)
    ? `${opensAt} até ${closesAt} do dia seguinte`
    : `${opensAt} até ${closesAt}`;
}
```

### Confirmação para ação crítica
```js
const ok = await confirmDialog({
  title: 'Forçar loja FECHADA?',
  body: 'Os clientes não conseguirão fazer pedidos até você voltar para Automático.',
  confirmLabel: 'Fechar a loja', danger: true,
}); // confirmDialog: <dialog> com el(); resolve true/false; Esc = false
if (ok) await withSaving(btn, () => adminApi('/api/admin/settings', { method: 'PUT', body: { storeOverride: 'closed' } }), { toast });
```

### Loja: número do WhatsApp (máscara → só dígitos com 55)
```js
// Exibir: "5585997687641" → "(85) 99768-7641". Digitar: aceita "(85) 99999-9999", "85 99999 9999", "+55 85 9…".
export function maskPhoneBR(value) {
  let d = String(value ?? '').replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  d = d.slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  const mid = d.length === 11 ? 7 : 6;
  return `(${d.slice(0, 2)}) ${d.slice(2, mid)}${d.length > mid ? '-' + d.slice(mid) : ''}`;
}
/** "(85) 99999-9999" → "5585999999999"; inválido → null (não envia). Mesmo formato do Zod: ^55\d{10,11}$ */
export function toWhatsAppDigits(value) {
  let d = String(value ?? '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  return /^\d{10,11}$/.test(d) ? `55${d}` : null;
}

async function saveWhatsApp(input, btn) {
  const digits = toWhatsAppDigits(input.value);
  if (!digits) return toast('Número inválido. Use DDD + número, ex.: (85) 99999-9999.', 'error');
  const ok = await confirmDialog({
    title: 'Trocar o número do WhatsApp?',
    body: `Os próximos pedidos serão enviados para ${maskPhoneBR(digits)}. Confira: número errado = pedido perdido.`,
    confirmLabel: 'Salvar número',
  });
  if (ok) await withSaving(btn, () => adminApi('/api/admin/settings', { method: 'PUT', body: { whatsappNumber: digits } }), { toast });
}
```

## Armadilhas
- `logout()` redireciona e **nunca resolve** — sempre `await`/`return` para não continuar o fluxo depois do redirect.
- Em `FormData` não definir `Content-Type` (o boundary some e o multer rejeita).
- `<input type="date">` devolve `YYYY-MM-DD` local do aparelho; o servidor interpreta o intervalo em `America/Fortaleza` — não converter para UTC no front.
- Criar produto e enviar foto são 2 chamadas: só faça o upload com o `id` retornado pelo POST.
- `addonGroup` ("Grupo: Borda | nenhum") só existe para `kind = 'addon'`; envie sempre `kind` junto e `addonGroup: null` para pizza/bebida (grupo em não-addon → 400 `VALIDATION_ERROR`, `path: 'addonGroup'`).
- Liberar `URL.createObjectURL` com `revokeObjectURL` ao trocar/fechar.
- Excluir produto que já aparece em pedido → 409 `PRODUCT_HAS_ORDERS` (checado por id em `order_items.product_ids`): oferecer "Marcar como esgotado".
- Formatos de leitura: `GET /api/admin/products` → `{ products }`; `GET /api/admin/orders` → `{ orders, page, pageSize, total }`; `GET /api/admin/orders/:id` → `{ order }` (com `items`). Desembrulhar (`const { products } = await adminApi(...)`).
- Não fazer polling agressivo de pedidos (bateria/dados do dono): botão "Atualizar" + atualização ao voltar para a aba (`visibilitychange`).
- Override `open`/`closed` esquecido trava vendas: exibir faixa permanente enquanto não for `auto`.
- Número do WhatsApp: o servidor **não** aceita máscara nem número sem `55` (400 `VALIDATION_ERROR`, `path: 'whatsappNumber'`) — sempre `toWhatsAppDigits()` antes do `PUT`. Envie só o campo alterado (`{ whatsappNumber }` ou `{ storeOverride }`); o outro não muda.

## Checklist final
- [ ] Login com e-mail fora de `ADMIN_EMAILS` volta ao login com "Este e-mail não tem acesso ao painel."
- [ ] Token expirado (ou apagado do sessionStorage) → próxima ação volta ao login sem erro feio.
- [ ] `grep -rn "supabase.from\|SERVICE_ROLE\|innerHTML" public/admin` vazio.
- [ ] Preço "34,99" salva `3499`; "abc" mostra erro e não envia.
- [ ] Addon com "Grupo: Borda" aparece no modal do cliente como radio junto das outras bordas; "nenhum" vira checkbox.
- [ ] Foto > 2 MB ou `.gif` bloqueada no front com mensagem; preview aparece antes de salvar.
- [ ] Toggle Esgotado reflete no `/api/menu` e no site do cliente.
- [ ] Horário 18:00→00:30 salva e mostra "do dia seguinte".
- [ ] Forçar fechada pede confirmação e deixa faixa visível; voltar para Automático remove.
- [ ] Loja: digitar "(85) 98888-7777" → confirmação → "Salvo ✓"; o próximo pedido abre `wa.me/5585988887777`. "(85) 9888" mostra erro e não envia.
- [ ] Pedido: confirmar/cancelar com feedback; cancelar pede confirmação.
- [ ] Resumo bate com a lista de pedidos do mesmo intervalo.
- [ ] Tudo usável com uma mão em 360px; botões ≥ 48px; foco visível.
