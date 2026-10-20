import express from 'express';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { hoursSchema } from '../../schemas/hours.schema.js';

const byWeekday = (a, b) => a.weekday - b.weekday;

/** Montado em /api/admin/hours (já atrás do requireAdmin). */
export function hoursRoutes({ db }) {
  const router = express.Router();
  router.get('/', asyncHandler(async (req, res) => {
    res.json({ hours: [...(await db.getHours())].sort(byWeekday) });
  }));
  router.put('/', validate(hoursSchema), asyncHandler(async (req, res) => {
    const saved = await db.updateHours(req.body);
    res.json({ hours: [...saved].sort(byWeekday) });
  }));
  return router;
}
