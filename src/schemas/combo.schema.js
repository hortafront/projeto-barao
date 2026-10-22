import { z } from 'zod';
import { freeText, uuid, distinct } from './order.schema.js';

const slotSchema = z.object({
  label: freeText(2, 40, 'O rótulo da vaga deve ter entre 2 e 40 caracteres.', 'O rótulo da vaga deve ter entre 2 e 40 caracteres.'),
  kind: z.enum(['pizza', 'drink'], { message: 'Tipo de vaga inválido.' }),
  productIds: z.array(uuid, { message: 'Escolha os produtos da vaga.' })
    .min(1, 'Escolha pelo menos um produto por vaga.')
    .refine(distinct, 'Produtos repetidos na vaga.'),
});

// Body do admin (POST/PUT). position = índice em slots.
export const comboInputSchema = z.object({
  name: freeText(2, 60, 'O nome deve ter entre 2 e 60 caracteres.', 'O nome deve ter entre 2 e 60 caracteres.'),
  description: freeText(0, 200, 'A descrição deve ter no máximo 200 caracteres.', 'A descrição deve ter no máximo 200 caracteres.')
    .optional().transform((v) => v ?? ''),
  priceCents: z.number({ message: 'Preço inválido.' }).int('Preço inválido.').positive('Preço inválido.').max(1_000_000, 'Preço inválido.'),
  weekdays: z.array(
    z.number({ message: 'Dia da semana inválido.' }).int('Dia da semana inválido.').min(0, 'Dia da semana inválido.').max(6, 'Dia da semana inválido.'),
    { message: 'Escolha pelo menos um dia da semana.' },
  ).min(1, 'Escolha pelo menos um dia da semana.').max(7, 'Dia da semana inválido.').refine(distinct, 'Dias da semana repetidos.'),
  slots: z.array(slotSchema, { message: 'Monte as vagas do combo.' })
    .min(1, 'O combo precisa de pelo menos 1 vaga.')
    .max(4, 'No máximo 4 vagas.'),
});
