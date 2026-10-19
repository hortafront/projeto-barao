import express from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';

/** Projeção pública do produto (sem categoryId/sortOrder). addonGroup: 'borda' | null (front monta radio por grupo). */
const toPublicProduct = ({ id, kind, name, description, priceCents, imageUrl, available, addonGroup }) =>
  ({ id, kind, name, description, priceCents, imageUrl, available, addonGroup: addonGroup ?? null });

const bySortOrderThenName = (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'pt-BR');

export function menuRoutes({ db }) {
  const router = express.Router();
  router.get('/', asyncHandler(async (req, res) => {
    const categories = await db.getMenu();
    res.set('Cache-Control', 'public, max-age=30');
    res.json({
      categories: categories
        .filter((c) => c.products.length > 0)
        .map((c) => ({
          slug: c.slug,
          name: c.name,
          products: [...c.products].sort(bySortOrderThenName).map(toPublicProduct),
        })),
    });
  }));
  return router;
}
