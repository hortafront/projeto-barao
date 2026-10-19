# Referência — schemas Zod (`src/schemas/*.schema.js`)

Escritos para funcionar em **zod 3.23+** (fixar `"zod": "^3.23.8"` no package.json; se migrar para zod 4, rever `.default()` dentro de `.partial()` e mensagens customizadas). Chaves desconhecidas são descartadas (`z.object` faz *strip*) — é assim que preços enviados pelo cliente somem.

## `src/schemas/order.schema.js`
```js
import { z } from 'zod';

const uuid = z.string().uuid('Item inválido.');
const distinct = (arr) => new Set(arr).size === arr.length;

export const addressSchema = z.object({
  street: z.string().trim().min(2, 'Informe a rua.').max(120),
  number: z.string().trim().min(1, 'Informe o número.').max(20),
  district: z.string().trim().min(2, 'Informe o bairro.').max(60),
  reference: z.string().trim().max(120).optional().default(''),
});

const pizzaItemSchema = z.object({
  kind: z.literal('pizza'),
  flavorIds: z.array(uuid)
    .min(1, 'Escolha pelo menos 1 sabor.')
    .max(2, 'No máximo 2 sabores (meio a meio).')
    .refine(distinct, 'Escolha dois sabores diferentes.'),
  addonIds: z.array(uuid).max(10).default([]).refine(distinct, 'Cada adicional só pode ser escolhido uma vez.'),
  quantity: z.number().int('Quantidade inválida.').min(1).max(20),
  notes: z.string().trim().max(140, 'Observação do item: até 140 caracteres.').optional().default(''),
});

const drinkItemSchema = z.object({
  kind: z.literal('drink'),
  productId: uuid,
  quantity: z.number().int('Quantidade inválida.').min(1).max(20),
});

export const orderItemSchema = z.discriminatedUnion('kind', [pizzaItemSchema, drinkItemSchema]);

const baseOrder = {
  customer: z.object({
    name: z.string().trim().min(2, 'Informe seu nome.').max(60),
    phone: z.string()
      .transform((s) => s.replace(/\D/g, ''))
      .pipe(z.string().regex(/^\d{10,11}$/, 'Telefone com DDD (10 ou 11 dígitos).')),
  }),
  payment: z.object({
    method: z.enum(['pix', 'cash', 'card']),
    changeForCents: z.number().int().positive().max(10_000_000).nullable().optional(),
  }),
  notes: z.string().trim().max(280, 'Observações: até 280 caracteres.').optional().default(''),
  items: z.array(orderItemSchema).min(1, 'Seu carrinho está vazio.').max(30, 'Máximo de 30 itens por pedido.'),
};

const deliveryOrderSchema = z.object({
  ...baseOrder,
  fulfillment: z.literal('delivery'),
  address: addressSchema, // obrigatório só na entrega
});

const pickupOrderSchema = z.object({
  ...baseOrder,
  fulfillment: z.literal('pickup'),
  address: z.unknown().optional().transform(() => null), // ignorado na retirada
});

export const createOrderSchema = z.discriminatedUnion('fulfillment', [deliveryOrderSchema, pickupOrderSchema]);

// Admin
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
export const ordersQuerySchema = z.object({
  from: isoDate,
  to: isoDate,
  page: z.coerce.number().int().min(1).default(1),
}).refine((q) => q.from <= q.to, { message: 'Data inicial maior que a final.', path: ['from'] });

export const orderStatusSchema = z.object({ status: z.enum(['received', 'confirmed', 'canceled']) });
export const idParamSchema = z.object({ id: uuid });
```
Regras que dependem do banco (kind correto, disponibilidade, troco >= total) ficam no service — o schema não conhece preços.

## `src/schemas/product.schema.js`
```js
import { z } from 'zod';

const productBase = z.object({
  categoryId: z.string().uuid(),
  kind: z.enum(['pizza', 'drink', 'addon']),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300),
  priceCents: z.number().int().min(0).max(1_000_000),
  available: z.boolean(),
  sortOrder: z.number().int().min(0).max(9999),
  // Grupo exclusivo de adicionais (no máximo 1 por pizza). Hoje só 'borda'; null = sem grupo.
  addonGroup: z.enum(['borda'], { message: 'Grupo inválido.' }).nullable(),
});

const ADDON_GROUP_ONLY_ADDON = {
  message: 'Só adicionais podem ter grupo (ex.: Borda).',
  path: ['addonGroup'],
};
// espelha o check do banco: addon_group is null or kind = 'addon'
const groupFitsKind = (p) => p.addonGroup == null || p.kind === undefined || p.kind === 'addon';

export const productCreateSchema = productBase.extend({
  description: productBase.shape.description.default(''),
  available: productBase.shape.available.default(true),
  sortOrder: productBase.shape.sortOrder.default(0),
  addonGroup: productBase.shape.addonGroup.default(null),
}).refine(groupFitsKind, ADDON_GROUP_ONLY_ADDON);

// sem defaults: PUT parcial não pode sobrescrever campos omitidos
export const productUpdateSchema = productBase.partial()
  .refine((p) => Object.keys(p).length > 0, 'Nada para atualizar.')
  .refine(groupFitsKind, ADDON_GROUP_ONLY_ADDON)
  // virou pizza/bebida sem mandar addonGroup → limpa o grupo (senão o check do banco falha)
  .transform((p) => (p.kind && p.kind !== 'addon' && p.addonGroup === undefined ? { ...p, addonGroup: null } : p));

export const availabilitySchema = z.object({ available: z.boolean() });
```
O admin digita preço em reais; o front converte com `parseBRLToCents` e envia `priceCents` inteiro.
`addonGroup`: `'borda'` ou `null` ("Grupo: Borda | nenhum" no form do admin, só para `kind = 'addon'`). Grupo em pizza/bebida → 400 `VALIDATION_ERROR` (path `addonGroup`). PUT de `addonGroup: 'borda'` sem `kind` no corpo passa no schema; o banco ainda barra pelo check se o produto não for addon — por isso o form do admin sempre envia `kind`.

## `src/schemas/hours.schema.js`
```js
import { z } from 'zod';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário no formato HH:MM.');

export const hoursSchema = z.array(z.object({
  weekday: z.number().int().min(0).max(6),
  opensAt: hhmm,
  closesAt: hhmm, // <= opensAt => vira a meia-noite
  isClosed: z.boolean(),
})).length(7, 'Informe os 7 dias.')
  .refine((days) => new Set(days.map((d) => d.weekday)).size === 7, 'Dias repetidos.');

// Igual ao check SQL de settings.whatsapp_number ('^55[0-9]{10,11}$'): só dígitos, 55 + DDD (2) + 8 ou 9 dígitos.
export const WHATSAPP_NUMBER_RE = /^55\d{10,11}$/;

/** PUT /api/admin/settings: ao menos um dos campos. O painel normaliza "(85) 99999-9999" → "5585999999999" antes de enviar. */
export const settingsSchema = z.object({
  storeOverride: z.enum(['auto', 'open', 'closed']).optional(),
  whatsappNumber: z.string().trim()
    .regex(WHATSAPP_NUMBER_RE, 'Número do WhatsApp inválido: use só dígitos com 55 + DDD + número (ex.: 5585999999999).')
    .optional(),
}).refine((s) => s.storeOverride !== undefined || s.whatsappNumber !== undefined, 'Nada para atualizar.');
```
O servidor **não** normaliza máscara: `"(85) 99999-9999"` ou `"85999999999"` (sem 55) → 400 `VALIDATION_ERROR` com `path: 'whatsappNumber'`. Corpo `{}` (ou só chaves desconhecidas, que o *strip* descarta) → 400 "Nada para atualizar.".
