# Referência — app, erros e middlewares

## `src/errors/AppError.js`
```js
export class AppError extends Error {
  /** code: STORE_CLOSED | VALIDATION_ERROR | PRODUCT_UNAVAILABLE | PRODUCT_HAS_ORDERS | NOT_FOUND | UNAUTHORIZED | FORBIDDEN | RATE_LIMITED | INTERNAL */
  constructor(code, status, message, details, options) {
    super(message, options); // options.cause preserva o erro original (só para log)
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
```

## `src/middleware/asyncHandler.js`
Express 4 **não** captura rejeição de handler `async` — sem isto o processo loga `UnhandledPromiseRejection` e a requisição fica pendurada.
```js
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
```

## `src/middleware/validate.js`
```js
import { AppError } from '../errors/AppError.js';

export const zodDetails = (error) => error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));

/** source: 'body' | 'query' | 'params'. Body é substituído pelo dado limpo; query/params vão para req.valid. */
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(new AppError('VALIDATION_ERROR', 400, 'Confira os dados informados.', zodDetails(result.error)));
    }
    req.valid = { ...req.valid, [source]: result.data };
    if (source === 'body') req.body = result.data;
    return next();
  };
}
```

## `src/middleware/errorHandler.js`
```js
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
  if (err?.type === 'entity.parse.failed') return new AppError('VALIDATION_ERROR', 400, 'JSON inválido.');
  if (err?.type === 'entity.too.large') return new AppError('VALIDATION_ERROR', 413, 'Requisição grande demais.');
  return new AppError('INTERNAL', 500, 'Ops! Algo deu errado. Tente novamente em instantes.', undefined, { cause: err });
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
```

## `src/middleware/requireAdmin.js`
```js
import { AppError } from '../errors/AppError.js';

export function requireAdmin({ db, adminEmails }) {
  const allowed = new Set(adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  return async (req, res, next) => {
    try {
      const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '');
      if (!match) throw new AppError('UNAUTHORIZED', 401, 'Faça login para continuar.');
      const user = await db.getUserByAccessToken(match[1]);
      if (!user) throw new AppError('UNAUTHORIZED', 401, 'Sessão expirada. Faça login novamente.');
      if (!user.email || !allowed.has(user.email.toLowerCase())) {
        throw new AppError('FORBIDDEN', 403, 'Este usuário não tem acesso ao painel.');
      }
      req.admin = { id: user.id, email: user.email };
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
```
`ADMIN_EMAILS` vazio ⇒ ninguém entra (fail closed).

## `src/middleware/rateLimit.js`
```js
import { rateLimit } from 'express-rate-limit';
import { AppError } from '../errors/AppError.js';

const passthrough = (req, res, next) => next();
const toAppError = (message) => (req, res, next) => next(new AppError('RATE_LIMITED', 429, message));

export function ordersRateLimit({ enabled = true } = {}) {
  if (!enabled) return passthrough;
  return rateLimit({
    windowMs: 10 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false,
    handler: toAppError('Muitos pedidos em pouco tempo. Aguarde alguns minutos e tente de novo.'),
  });
}

export function adminRateLimit({ enabled = true } = {}) {
  if (!enabled) return passthrough;
  return rateLimit({
    windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false,
    handler: toAppError('Muitas requisições. Aguarde alguns minutos.'),
  });
}
```

## `src/middleware/upload.js`
```js
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
```
Rota: `router.post('/:id/image', validate(idParamSchema, 'params'), imageUpload, asyncHandler(...))` → checa `req.file`, `sniffImageType`, `db.getProductById` (404 antes de subir arquivo) e então `db.uploadProductImage(id, { buffer, contentType })`.

## `src/middleware/requestLogger.js`
```js
export function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    if (!req.originalUrl.startsWith('/api')) return;
    console.log(JSON.stringify({
      level: 'info', method: req.method, path: req.originalUrl.split('?')[0],
      status: res.statusCode, ms: Number((process.hrtime.bigint() - start) / 1_000_000n),
    }));
  });
  next();
}
```
Nunca logar `req.body`, headers (`Authorization`!), query de pedidos, nome, telefone, endereço ou a mensagem do WhatsApp.

## `src/app.js`
```js
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { AppError } from './errors/AppError.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { requireAdmin } from './middleware/requireAdmin.js';
import { adminRateLimit } from './middleware/rateLimit.js';
import { menuRoutes } from './routes/menu.routes.js';
import { statusRoutes } from './routes/status.routes.js';
import { ordersRoutes } from './routes/orders.routes.js';
import { adminRoutes } from './routes/admin/index.js';
import { adminConfigRoutes } from './routes/adminConfig.routes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** TRUST_PROXY: vazio → false; número ('1') → hops; outro texto ('loopback') → repassado ao Express. */
function parseTrustProxy(v) {
  if (v == null || v === '' || v === 'false') return false;
  if (v === 'true') return true;
  return /^\d+$/.test(v) ? Number(v) : v;
}

function cspDirectives(supabaseUrl, isProduction) {
  const supabase = supabaseUrl ? [new URL(supabaseUrl).origin] : [];
  return {
    'default-src': ["'self'"],
    'script-src': ["'self'", 'https://cdn.jsdelivr.net'], // supabase-js ESM no /admin
    'style-src': ["'self'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com'],
    'img-src': ["'self'", 'data:', ...supabase],          // imagens do bucket product-images
    'connect-src': ["'self'", ...supabase],               // login do admin no Supabase Auth (SUPABASE_URL)
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'object-src': ["'none'"],
    'upgrade-insecure-requests': isProduction ? [] : null,
  };
}

/**
 * options (todas opcionais; o default vem do env):
 * { now, rateLimit, adminEmails, corsOrigin, supabaseUrl, supabaseAnonKey, timeZone, isProduction, trustProxy }
 */
export function createApp({ db, options = {} } = {}) {
  if (!db) throw new Error('createApp: db é obrigatório');
  const opts = {
    corsOrigin: process.env.CORS_ORIGIN ?? '',
    adminEmails: (process.env.ADMIN_EMAILS ?? '').split(','),
    supabaseUrl: process.env.SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? '', // pública; só para o login do admin
    timeZone: process.env.STORE_TIMEZONE || 'America/Fortaleza',
    isProduction: process.env.NODE_ENV === 'production',
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY), // atrás de proxy (Render/Railway/Nginx): TRUST_PROXY=1
    rateLimit: true,          // testes de integração: false
    now: () => new Date(),    // testes: relógio fixo
    ...options,
  };

  const app = express();
  app.disable('x-powered-by');
  if (opts.trustProxy) app.set('trust proxy', opts.trustProxy);

  // 1. segurança
  app.use(helmet({ contentSecurityPolicy: { directives: cspDirectives(opts.supabaseUrl, opts.isProduction) } }));
  const origins = opts.corsOrigin.split(',').map((s) => s.trim()).filter(Boolean);
  app.use(cors({ origin: origins.length ? origins : false }));
  // 2. body
  app.use(express.json({ limit: '20kb' }));
  app.use(requestLogger);
  // 3. estáticos
  app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));
  app.use('/shared', express.static(path.join(ROOT, 'shared')));
  // 4. rotas
  app.use('/api/menu', menuRoutes({ db }));
  app.use('/api/status', statusRoutes({ db, options: opts }));
  app.use('/api/orders', ordersRoutes({ db, options: opts }));
  // pública (fora do requireAdmin): o login do admin precisa dela ANTES de ter token
  app.use('/api/admin-config', adminConfigRoutes({ options: opts }));
  app.use('/api/admin',
    adminRateLimit({ enabled: opts.rateLimit }),
    requireAdmin({ db, adminEmails: opts.adminEmails }),
    adminRoutes({ db, options: opts }));
  // 5. 404
  app.use('/api', (req, res, next) => next(new AppError('NOT_FOUND', 404, 'Rota não encontrada.')));
  app.use((req, res) => res.status(404).type('text/plain').send('Página não encontrada'));
  // 6. erros (sempre por último, 4 argumentos)
  app.use(errorHandler);
  return app;
}
```

## `src/routes/menu.routes.js`
```js
import express from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';

/** Projeção pública do produto (sem categoryId/sortOrder). addonGroup: 'borda' | null (front monta radio por grupo). */
const toPublicProduct = ({ id, kind, name, description, priceCents, imageUrl, available, addonGroup }) =>
  ({ id, kind, name, description, priceCents, imageUrl, available, addonGroup: addonGroup ?? null });

export function menuRoutes({ db }) {
  const router = express.Router();
  router.get('/', asyncHandler(async (req, res) => {
    const categories = await db.getMenu();
    res.set('Cache-Control', 'public, max-age=30');
    res.json({
      categories: categories
        .filter((c) => c.products.length > 0)
        .map((c) => ({ slug: c.slug, name: c.name, products: c.products.map(toPublicProduct) })),
    });
  }));
  return router;
}
```

## `src/routes/adminConfig.routes.js`
```js
import express from 'express';

/** GET /api/admin-config → { supabaseUrl, supabaseAnonKey }. Pública, sem auth, cache curto. */
export function adminConfigRoutes({ options }) {
  const router = express.Router();
  router.get('/', (req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ supabaseUrl: options.supabaseUrl, supabaseAnonKey: options.supabaseAnonKey });
  });
  return router;
}
```
A ANON key é pública por natureza (com RLS sem policies ela não lê dados); **nunca** devolver a service role aqui.

## `src/routes/admin/products.routes.js` — DELETE
```js
router.delete('/:id', validate(idParamSchema, 'params'), asyncHandler(async (req, res) => {
  // o repo lança AppError PRODUCT_HAS_ORDERS (409) se algum order_item tem o id em product_ids
  const removed = await db.deleteProduct(req.valid.params.id);
  if (!removed) throw new AppError('NOT_FOUND', 404, 'Produto não encontrado.');
  res.status(204).end();
}));
```
Respostas de leitura do admin: `GET /api/admin/products` → `{ products }`; `GET /api/admin/orders` → `{ orders, page, pageSize, total }`; `GET /api/admin/orders/:id` → `{ order }` (com `items`).

## `src/routes/admin/settings.routes.js`
```js
import express from 'express';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { settingsSchema } from '../../schemas/hours.schema.js';

/** Montado em /api/admin/settings (já atrás do requireAdmin). */
export function settingsRoutes({ db }) {
  const router = express.Router();
  router.get('/', asyncHandler(async (req, res) => res.json(await db.getSettings())));
  // body limpo: { storeOverride?, whatsappNumber? } — só os campos enviados são alterados
  router.put('/', validate(settingsSchema), asyncHandler(async (req, res) => res.json(await db.updateSettings(req.body))));
  return router;
}
```
O número novo vale já no próximo `POST /api/orders` (o `order.service` lê `db.getSettings()` a cada pedido; nada de cache).

## `src/server.js`
```js
import { createApp } from './app.js';
import { createSupabaseClient } from './db/supabase.js';
import { createRepository } from './db/repositories/index.js';

export { createApp };

const db = createRepository(createSupabaseClient());
const port = Number(process.env.PORT) || 3000;
createApp({ db }).listen(port, () => console.log(JSON.stringify({ level: 'info', msg: `Barão API na porta ${port}` })));
```
Testes importam `src/app.js` (não `server.js`, que conecta no Supabase e abre porta).
