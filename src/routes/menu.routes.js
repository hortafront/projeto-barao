import express from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { getTodayPublicCombo } from '../services/combo.service.js';

/** Projeção pública do produto (sem categoryId/sortOrder). addonGroup: 'borda' | null (front monta radio por grupo). */
const toPublicProduct = ({ id, kind, name, description, priceCents, imageUrl, available, addonGroup }) =>
  ({ id, kind, name, description, priceCents, imageUrl, available, addonGroup: addonGroup ?? null });

const bySortOrderThenName = (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'pt-BR');

export function menuRoutes({ db, options }) {
  const router = express.Router();
  router.get('/', asyncHandler(async (req, res) => {
    const categories = await db.getMenu();
    const productsById = new Map(categories.flatMap((c) => c.products).map((p) => [p.id, p]));
    const combo = await getTodayPublicCombo(db, { now: options.now(), timeZone: options.timeZone, productsById });
    res.set('Cache-Control', 'public, max-age=30');
    res.json({
      categories: categories
        .filter((c) => c.products.length > 0)
        .map((c) => ({
          slug: c.slug,
          name: c.name,
          products: [...c.products].sort(bySortOrderThenName).map(toPublicProduct),
        })),
      combo,
    });
  }));
  return router;
}
