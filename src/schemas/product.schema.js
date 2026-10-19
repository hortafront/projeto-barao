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
const groupFitsKind = (p) => p.addonGroup == null || p.kind === 'addon';

export const productCreateSchema = productBase.extend({
  description: productBase.shape.description.default(''),
  available: productBase.shape.available.default(true),
  sortOrder: productBase.shape.sortOrder.default(0),
  addonGroup: productBase.shape.addonGroup.default(null),
}).refine(groupFitsKind, ADDON_GROUP_ONLY_ADDON);

// PUT: name, priceCents, categoryId e kind obrigatórios; os demais sem default
// (campo omitido não sobrescreve o que está no banco).
export const productUpdateSchema = productBase.extend({
  description: productBase.shape.description.optional(),
  available: productBase.shape.available.optional(),
  sortOrder: productBase.shape.sortOrder.optional(),
  addonGroup: productBase.shape.addonGroup.optional(),
})
  .refine(groupFitsKind, ADDON_GROUP_ONLY_ADDON)
  // virou pizza/bebida sem mandar addonGroup → limpa o grupo (senão o check do banco falha)
  .transform((p) => (p.kind !== 'addon' && p.addonGroup === undefined ? { ...p, addonGroup: null } : p));

export const availabilitySchema = z.object({ available: z.boolean() });
