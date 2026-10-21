import express from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireCustomer } from '../middleware/requireCustomer.js';
import { validate } from '../middleware/validate.js';
import { ordersRateLimit } from '../middleware/rateLimit.js';
import { createOrderSchema } from '../schemas/order.schema.js';
import { createOrder } from '../services/order.service.js';

const MAX_URL_LENGTH = 4000;

export function ordersRoutes({ db, options }) {
  const router = express.Router();
  router.post('/',
    ordersRateLimit({ enabled: options.rateLimit }),
    requireCustomer({ db }),
    validate(createOrderSchema),
    asyncHandler(async (req, res) => {
      const result = await createOrder(req.body, { db, now: options.now(), timeZone: options.timeZone,
        customerId: req.customer.id });
      console.log(JSON.stringify({ level: 'info', msg: 'order_created', code: result.code,
        subtotalCents: result.subtotalCents, items: req.body.items.length }));
      if (result.whatsappUrl.length > MAX_URL_LENGTH) {
        console.warn(JSON.stringify({ level: 'warn', msg: 'whatsapp_url_long', code: result.code,
          length: result.whatsappUrl.length }));
      }
      res.status(201).json(result);
    }));
  return router;
}
