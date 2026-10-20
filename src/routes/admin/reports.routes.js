import express from 'express';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { summaryQuerySchema } from '../../schemas/order.schema.js';
import { resolveLocalDateRange } from '../../services/dateRange.service.js';

export function reportsRoutes({ db, options }) {
  const router = express.Router();

  router.get('/summary', validate(summaryQuerySchema, 'query'), asyncHandler(async (req, res) => {
    const range = resolveLocalDateRange(req.valid.query, { now: options.now, timeZone: options.timeZone });
    const { ordersCount, grossCents, topItems } = await db.getOrdersSummary(range);
    res.json({ ordersCount, grossCents, topItems });
  }));

  return router;
}
