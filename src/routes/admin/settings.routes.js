import express from 'express';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { settingsSchema } from '../../schemas/hours.schema.js';

/** Montado em /api/admin/settings (já atrás do requireAdmin). */
export function settingsRoutes({ db }) {
  const router = express.Router();
  router.get('/', asyncHandler(async (req, res) => res.json(await db.getSettings())));
  // body limpo: { storeOverride?, whatsappNumber? } — só os campos enviados são alterados
  router.put('/', validate(settingsSchema), asyncHandler(async (req, res) => res.json(await db.updateSettings(req.body))));
  return router;
}
