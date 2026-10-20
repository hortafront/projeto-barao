import express from 'express';
import { AppError } from '../../errors/AppError.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { idParamSchema, orderStatusSchema, ordersQuerySchema } from '../../schemas/order.schema.js';
import { resolveLocalDateRange, toAdminOrderDetail, toAdminOrderListItem } from '../../services/dateRange.service.js';

const PAGE_SIZE = 20;
const notFound = () => new AppError('NOT_FOUND', 404, 'Pedido não encontrado.');

export function adminOrdersRoutes({ db, options }) {
  const router = express.Router();

  router.get('/', validate(ordersQuerySchema, 'query'), asyncHandler(async (req, res) => {
    const { page, ...period } = req.valid.query;
    const range = resolveLocalDateRange(period, { now: options.now, timeZone: options.timeZone });
    const result = await db.listOrders({ ...range, page, pageSize: PAGE_SIZE });
    res.json({
      orders: result.orders.map(toAdminOrderListItem),
      page: result.page,
      pageSize: PAGE_SIZE,
      total: result.total,
    });
  }));

  router.get('/:id', validate(idParamSchema, 'params'), asyncHandler(async (req, res) => {
    const order = await db.getOrderById(req.valid.params.id);
    if (!order) throw notFound();
    res.json({ order: toAdminOrderDetail(order) });
  }));

  router.patch('/:id/status', validate(idParamSchema, 'params'), validate(orderStatusSchema), asyncHandler(async (req, res) => {
    const order = await db.updateOrderStatus(req.valid.params.id, req.valid.body.status);
    if (!order) throw notFound();
    res.json({ order: toAdminOrderDetail(order) });
  }));

  return router;
}
