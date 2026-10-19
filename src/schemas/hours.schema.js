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
