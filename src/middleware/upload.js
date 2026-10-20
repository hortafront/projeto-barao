import multer from 'multer';
import { AppError } from '../errors/AppError.js';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 5 },
  fileFilter: (req, file, cb) => (ALLOWED.has(file.mimetype)
    ? cb(null, true)
    : cb(new AppError('VALIDATION_ERROR', 400, 'Envie uma imagem JPG, PNG ou WebP.'))),
}).single('image');

/** mimetype vem do cliente: confirmar pelos bytes mágicos. */
export function sniffImageType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
