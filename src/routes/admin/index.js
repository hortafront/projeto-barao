import express from 'express';
import { productsRoutes } from './products.routes.js';
import { hoursRoutes } from './hours.routes.js';
import { settingsRoutes } from './settings.routes.js';
import { adminOrdersRoutes } from './orders.routes.js';
import { reportsRoutes } from './reports.routes.js';

/** Montado em /api/admin, já atrás de adminRateLimit + requireAdmin. */
export function adminRoutes({ db, options }) {
  const router = express.Router();
  router.use('/products', productsRoutes({ db, options }));
  router.use('/hours', hoursRoutes({ db, options }));
  router.use('/settings', settingsRoutes({ db, options }));
  router.use('/orders', adminOrdersRoutes({ db, options }));
  router.use('/reports', reportsRoutes({ db, options }));
  return router;
}
