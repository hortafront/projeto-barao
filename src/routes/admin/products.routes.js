import express from 'express';
import { AppError } from '../../errors/AppError.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { imageUpload, sniffImageType } from '../../middleware/upload.js';
import { productCreateSchema, productUpdateSchema, availabilitySchema } from '../../schemas/product.schema.js';
import { idParamSchema } from '../../schemas/order.schema.js';

/** AdminProduct (spec §5.4): produto + categorySlug. */
export function toAdminProduct(product, categoriesById) {
  return {
    id: product.id,
    categoryId: product.categoryId,
    categorySlug: categoriesById.get(product.categoryId)?.slug ?? null,
    kind: product.kind,
    name: product.name,
    description: product.description,
    priceCents: product.priceCents,
    imageUrl: product.imageUrl ?? null,
    available: product.available,
    sortOrder: product.sortOrder,
    addonGroup: product.addonGroup ?? null,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

const notFound = () => new AppError('NOT_FOUND', 404, 'Produto não encontrado.');
const unknownCategory = () => new AppError('VALIDATION_ERROR', 400, 'Confira os dados informados.',
  [{ path: 'categoryId', message: 'Categoria não encontrada.' }]);

/** Montado em /api/admin/products (já atrás do requireAdmin). */
export function productsRoutes({ db }) {
  const router = express.Router();

  const categoriesById = async () => new Map((await db.listCategories()).map((c) => [c.id, c]));
  const assertCategory = async (categoryId) => {
    if (!(await categoriesById()).has(categoryId)) throw unknownCategory();
  };
  const respond = async (product) => ({ product: toAdminProduct(product, await categoriesById()) });

  router.get('/', asyncHandler(async (req, res) => {
    const [categories, products] = await Promise.all([db.listCategories(), db.listProducts()]);
    const byId = new Map(categories.map((c) => [c.id, c]));
    const order = (p) => byId.get(p.categoryId)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const sorted = products.slice().sort((a, b) => order(a) - order(b) || a.sortOrder - b.sortOrder);
    res.json({ products: sorted.map((p) => toAdminProduct(p, byId)) });
  }));

  router.post('/', validate(productCreateSchema), asyncHandler(async (req, res) => {
    await assertCategory(req.body.categoryId);
    res.status(201).json(await respond(await db.createProduct(req.body)));
  }));

  router.put('/:id', validate(idParamSchema, 'params'), validate(productUpdateSchema), asyncHandler(async (req, res) => {
    await assertCategory(req.body.categoryId);
    const product = await db.updateProduct(req.valid.params.id, req.body);
    if (!product) throw notFound();
    res.json(await respond(product));
  }));

  router.delete('/:id', validate(idParamSchema, 'params'), asyncHandler(async (req, res) => {
    // o repo lança AppError PRODUCT_HAS_ORDERS (409) se algum order_item tem o id em product_ids
    const removed = await db.deleteProduct(req.valid.params.id);
    if (!removed) throw notFound();
    res.status(204).end();
  }));

  router.patch('/:id/availability', validate(idParamSchema, 'params'), validate(availabilitySchema), asyncHandler(async (req, res) => {
    const product = await db.setProductAvailability(req.valid.params.id, req.body.available);
    if (!product) throw notFound();
    res.json(await respond(product));
  }));

  router.post('/:id/image', validate(idParamSchema, 'params'), imageUpload, asyncHandler(async (req, res) => {
    const { id } = req.valid.params;
    if (!req.file) throw new AppError('VALIDATION_ERROR', 400, 'Envie uma imagem JPG, PNG ou WebP.');
    const sniffed = sniffImageType(req.file.buffer);
    if (!sniffed || sniffed !== req.file.mimetype) {
      throw new AppError('VALIDATION_ERROR', 400, 'Envie uma imagem JPG, PNG ou WebP.');
    }
    if (!(await db.getProductById(id))) throw notFound(); // 404 antes de subir arquivo
    const product = await db.uploadProductImage(id, { buffer: req.file.buffer, contentType: sniffed });
    res.json(await respond(product));
  }));

  return router;
}
