import { rateLimit } from 'express-rate-limit';
import { AppError } from '../errors/AppError.js';

const MESSAGE = 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
const passthrough = (req, res, next) => next();
const toAppError = (req, res, next) => next(new AppError('RATE_LIMITED', 429, MESSAGE));

export function ordersRateLimit({ enabled = true } = {}) {
  if (!enabled) return passthrough;
  return rateLimit({ windowMs: 10 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, handler: toAppError });
}

export function adminRateLimit({ enabled = true } = {}) {
  if (!enabled) return passthrough;
  return rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false, handler: toAppError });
}
