import express from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { profileSchema, addressInputSchema } from '../schemas/customer.schema.js';
import { idParamSchema } from '../schemas/order.schema.js';
import {
  getAccount, saveProfile, addAddress, editAddress, removeAddress, makeDefaultAddress, deleteAccount,
} from '../services/customer.service.js';

/** Montado em /api/me (já atrás do requireCustomer: req.customer = { id, email }). */
export function meRoutes({ db, options = {} }) {
  const router = express.Router();

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await getAccount(db, req.customer));
  }));

  router.put('/', validate(profileSchema), asyncHandler(async (req, res) => {
    res.json({ profile: await saveProfile(db, req.customer.id, req.body) });
  }));

  router.post('/addresses', validate(addressInputSchema), asyncHandler(async (req, res) => {
    res.status(201).json({ address: await addAddress(db, req.customer.id, req.body) });
  }));

  router.put('/addresses/:id', validate(idParamSchema, 'params'), validate(addressInputSchema), asyncHandler(async (req, res) => {
    res.json({ address: await editAddress(db, req.customer.id, req.valid.params.id, req.body) });
  }));

  router.delete('/addresses/:id', validate(idParamSchema, 'params'), asyncHandler(async (req, res) => {
    await removeAddress(db, req.customer.id, req.valid.params.id);
    res.status(204).end();
  }));

  router.patch('/addresses/:id/default', validate(idParamSchema, 'params'), asyncHandler(async (req, res) => {
    res.json({ address: await makeDefaultAddress(db, req.customer.id, req.valid.params.id) });
  }));

  router.delete('/', asyncHandler(async (req, res) => {
    await deleteAccount(db, req.customer, options.adminEmails);
    res.status(204).end();
  }));

  return router;
}
