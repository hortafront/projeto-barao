import { z } from 'zod';

const uuid = z.string({ message: 'Item inválido.' }).uuid('Item inválido.');
const QTY_MSG = 'Quantidade deve ser entre 1 e 20.';
const quantity = z.number({ message: QTY_MSG }).int(QTY_MSG).min(1, QTY_MSG).max(20, QTY_MSG);
const distinct = (arr) => new Set(arr).size === arr.length;

// Texto livre: troca surrogates soltos por U+FFFD antes de validar, depois aplica trim e limites.
// Limites contam code points (como char_length do Postgres), não unidades UTF-16.
// Mensagens separadas: minMsg (vazio/curto ou ausente) e maxMsg (comprimento acima do limite).
export const freeText = (min, max, minMsg, maxMsg) =>
  z.string({ message: minMsg })
    .transform((s) => s.toWellFormed())
    .pipe(z.string().trim()
      .refine((s) => [...s].length >= min, minMsg)
      .refine((s) => [...s].length <= max, maxMsg));

// Opcional: vazio/ausente vira null.
export const optionalText = (max, maxMsg) =>
  freeText(0, max, maxMsg, maxMsg).optional().transform((v) => v || null);

export const phoneSchema = z.string()
  .transform((s) => s.replace(/\D/g, ''))
  .pipe(z.string().regex(/^\d{10,11}$/, 'Telefone com DDD (10 ou 11 dígitos).'));

export const addressSchema = z.object({
  street: freeText(2, 120, 'Informe a rua.', 'A rua deve ter no máximo 120 caracteres.'),
  number: freeText(1, 10, 'Informe o número.', 'O número deve ter no máximo 10 caracteres.'),
  district: freeText(2, 60, 'Informe o bairro.', 'O bairro deve ter no máximo 60 caracteres.'),
  reference: optionalText(120, 'A referência deve ter no máximo 120 caracteres.'),
});

const pizzaItemSchema = z.object({
  kind: z.literal('pizza'),
  flavorIds: z.array(uuid)
    .min(1, 'Escolha pelo menos 1 sabor.')
    .max(2, 'No máximo 2 sabores (meio a meio).')
    .refine(distinct, 'Escolha dois sabores diferentes.'),
  addonIds: z.array(uuid).max(10, 'No máximo 10 adicionais por pizza.').default([]).refine(distinct, 'Cada adicional só pode ser escolhido uma vez.'),
  quantity,
  notes: optionalText(140, 'A observação do item deve ter no máximo 140 caracteres.'),
});

const drinkItemSchema = z.object({
  kind: z.literal('drink'),
  productId: uuid,
  quantity,
});

export const orderItemSchema = z.discriminatedUnion('kind', [pizzaItemSchema, drinkItemSchema], { errorMap: () => ({ message: 'Item inválido.' }) });

const baseOrder = {
  customer: z.object({
    name: freeText(2, 60, 'Informe seu nome.', 'O nome deve ter no máximo 60 caracteres.'),
    phone: phoneSchema,
  }),
  payment: z.object({
    method: z.enum(['pix', 'cash', 'card'], { message: 'Escolha a forma de pagamento.' }),
    changeForCents: z.number({ message: 'Valor do troco inválido.' }).int('Valor do troco inválido.')
      .min(0, 'Valor do troco inválido.').max(10_000_000, 'Valor do troco inválido.').nullable().optional(),
  }),
  notes: optionalText(280, 'As observações devem ter no máximo 280 caracteres.'),
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

export const createOrderSchema = z.discriminatedUnion('fulfillment', [deliveryOrderSchema, pickupOrderSchema], {
  errorMap: () => ({ message: 'Escolha entrega ou retirada.' }),
});

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
