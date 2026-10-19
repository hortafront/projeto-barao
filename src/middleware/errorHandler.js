import multer from 'multer';
import { ZodError } from 'zod';
import { AppError } from '../errors/AppError.js';
import { zodDetails } from './validate.js';

function normalize(err) {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) return new AppError('VALIDATION_ERROR', 400, 'Confira os dados informados.', zodDetails(err));
  if (err instanceof multer.MulterError) {
    return err.code === 'LIMIT_FILE_SIZE'
      ? new AppError('VALIDATION_ERROR', 413, 'A imagem deve ter no máximo 2 MB.')
      : new AppError('VALIDATION_ERROR', 400, 'Envio de arquivo inválido.');
  }
  if (err?.type === 'entity.parse.failed') return new AppError('VALIDATION_ERROR', 400, 'Confira os dados informados.');
  if (err?.type === 'entity.too.large') return new AppError('VALIDATION_ERROR', 413, 'Confira os dados informados.');
  return new AppError('INTERNAL', 500, 'Algo deu errado do nosso lado. Tente de novo ou chame no WhatsApp.', undefined, { cause: err });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const e = normalize(err);
  if (e.status >= 500) {
    const cause = e.cause ?? err;
    console.error(JSON.stringify({
      level: 'error', code: e.code, method: req.method, path: req.originalUrl.split('?')[0],
      error: cause?.message, pgCode: cause?.pgCode,
      stack: process.env.NODE_ENV === 'production' ? undefined : cause?.stack,
    }));
  }
  if (res.headersSent) return next(err);
  const body = { error: { code: e.code, message: e.message } };
  if (e.details?.length) body.error.details = e.details;
  return res.status(e.status).json(body);
}
