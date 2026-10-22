import express from 'express';
import { AppError } from '../../errors/AppError.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { imageUpload, sniffImageType } from '../../middleware/upload.js';
import { comboInputSchema } from '../../schemas/combo.schema.js';
import { availabilitySchema } from '../../schemas/product.schema.js';
import { idParamSchema } from '../../schemas/order.schema.js';
import { assertComboInput } from '../../services/combo.service.js';

const notFound = () => new AppError('NOT_FOUND', 404, 'Combo não encontrado.');

/** Montado em /api/admin/combos (já atrás do requireAdmin). */
export function combosRoutes({ db }) {
  const router = express.Router();

  router.get('/', asyncHandler(async (req, res) => {
    res.json({ combos: await db.listCombos() });
  }));

  router.post('/', validate(comboInputSchema), asyncHandler(async (req, res) => {
    await assertComboInput(db, req.body);
    res.status(201).json({ combo: await db.createCombo(req.body) });
  }));

  router.put('/:id', validate(idParamSchema, 'params'), validate(comboInputSchema), asyncHandler(async (req, res) => {
    const { id } = req.valid.params;
    if (!(await db.getCombo(id))) throw notFound();
    await assertComboInput(db, req.body, { excludeId: id });
    const combo = await db.updateCombo(id, req.body);
    if (!combo) throw notFound();
    res.json({ combo });
  }));

  router.delete('/:id', validate(idParamSchema, 'params'), asyncHandler(async (req, res) => {
    // o repo lança AppError PRODUCT_HAS_ORDERS (409) se algum order_item referencia o combo
    const removed = await db.deleteCombo(req.valid.params.id);
    if (!removed) throw notFound();
    res.status(204).end();
  }));

  router.patch('/:id/availability', validate(idParamSchema, 'params'), validate(availabilitySchema), asyncHandler(async (req, res) => {
    const combo = await db.setComboAvailability(req.valid.params.id, req.body.available);
    if (!combo) throw notFound();
    res.json({ combo });
  }));

  router.post('/:id/image', validate(idParamSchema, 'params'), imageUpload, asyncHandler(async (req, res) => {
    const { id } = req.valid.params;
    if (!req.file) throw new AppError('VALIDATION_ERROR', 400, 'Envie uma imagem JPG, PNG ou WebP.');
    const sniffed = sniffImageType(req.file.buffer);
    if (!sniffed || sniffed !== req.file.mimetype) {
      throw new AppError('VALIDATION_ERROR', 400, 'Envie uma imagem JPG, PNG ou WebP.');
    }
    if (!(await db.getCombo(id))) throw notFound(); // 404 antes de subir arquivo
    res.json({ combo: await db.uploadComboImage(id, { buffer: req.file.buffer, contentType: sniffed }) });
  }));

  return router;
}
