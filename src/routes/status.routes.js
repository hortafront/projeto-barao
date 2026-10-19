import express from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { getStoreStatus } from '../services/hours.service.js';

export function statusRoutes({ db, options }) {
  const router = express.Router();
  router.get('/', asyncHandler(async (req, res) => {
    const hours = await db.getHours();
    const { storeOverride } = await db.getSettings();
    res.set('Cache-Control', 'no-store');
    res.json(getStoreStatus(options.now(), hours, storeOverride, options.timeZone));
  }));
  return router;
}
