import { z } from 'zod';
import { addressSchema, freeText, optionalText, phoneSchema } from './order.schema.js';

export const profileSchema = z.object({
  name: freeText(2, 60, 'Informe seu nome.', 'O nome deve ter no máximo 60 caracteres.'),
  phone: phoneSchema,
});

export const addressInputSchema = addressSchema.extend({
  label: optionalText(30, 'O apelido deve ter no máximo 30 caracteres.'),
  isDefault: z.boolean({ message: 'Valor inválido.' }).optional(),
});
