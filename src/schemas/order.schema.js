import { z } from 'zod';

const uuid = z.string().uuid('Item inválido.');
const distinct = (arr) => new Set(arr).size === arr.length;

// Texto livre: troca surrogates soltos por U+FFFD antes de validar, depois aplica trim e limites.
const freeText = (min, max, msg) =>
  z.string()
    .transform((s) => s.toWellFormed())
    .pipe(z.string().trim().min(min, msg).max(max, msg));

// Opcional: vazio/ausente vira null.
const optionalText = (max, msg) =>
  freeText(0, max, msg).optional().transform((v) => v || null);

export const addressSchema = z.object({
  street: freeText(2, 120, 'Informe a rua.'),
  number: freeText(1, 10, 'Informe o número (até 10 caracteres).'),
  district: freeText(2, 60, 'Informe o bairro.'),
  reference: optionalText(120, 'Referência: até 120 caracteres.'),
});

const pizzaItemSchema = z.object({
  kind: z.literal('pizza'),
  flavorIds: z.array(uuid)
    .min(1, 'Escolha pelo menos 1 sabor.')
    .max(2, 'No máximo 2 sabores (meio a meio).')
    .refine(distinct, 'Escolha dois sabores diferentes.'),
  addonIds: z.array(uuid).max(10).default([]).refine(distinct, 'Cada adicional só pode ser escolhido uma vez.'),
  quantity: z.number().int('Quantidade inválida.').min(1).max(20),
  notes: optionalText(140, 'Observação do item: até 140 caracteres.'),
});

const drinkItemSchema = z.object({
  kind: z.literal('drink'),
  productId: uuid,
  quantity: z.number().int('Quantidade inválida.').min(1).max(20),
});

export const orderItemSchema = z.discriminatedUnion('kind', [pizzaItemSchema, drinkItemSchema]);

const baseOrder = {
  customer: z.object({
    name: freeText(2, 60, 'Informe seu nome.'),
    phone: z.string()
      .transform((s) => s.replace(/\D/g, ''))
      .pipe(z.string().regex(/^\d{10,11}$/, 'Telefone com DDD (10 ou 11 dígitos).')),
  }),
  payment: z.object({
    method: z.enum(['pix', 'cash', 'card']),
    changeForCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  }),
  notes: optionalText(280, 'Observações: até 280 caracteres.'),
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

// Admin. A ordem from <= to, o limite de 366 dias e o padrão "hoje" ficam no dateRange.service.
const isoDate = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.')
  .refine((d) => {
    const t = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(t.getTime()) && t.toISOString().startsWith(d);
  }, 'Data inexistente.');

export const summaryQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const ordersQuerySchema = summaryQuerySchema.extend({
  page: z.coerce.number().int().min(1).default(1),
});

export const orderStatusSchema = z.object({ status: z.enum(['received', 'confirmed', 'canceled']) });
export const idParamSchema = z.object({ id: uuid });
