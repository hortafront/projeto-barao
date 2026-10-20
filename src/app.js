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
    'img-src': ["'self'", 'data:', 'blob:', ...supabase], // bucket product-images + preview (blob:) do upload no admin
    'connect-src': ["'self'", ...supabase], // login do admin no Supabase Auth
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
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY), // atrás de proxy: TRUST_PROXY=1
    rateLimit: true, // testes de integração: false
    now: () => new Date(), // testes: relógio fixo
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
  // html/js/css (inclui /shared) → no-cache (revalida por ETag; evita módulos misturados após deploy); img → 1h
  const staticOptions = {
    setHeaders(res, filePath) {
      if (/\.(html|js|css)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
      else res.setHeader('Cache-Control', 'public, max-age=3600');
      if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    },
  };
  app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'], ...staticOptions }));
  app.use('/shared', express.static(path.join(ROOT, 'shared'), staticOptions));
  // 4. rotas
  app.use('/api/menu', menuRoutes({ db, options: opts }));
  app.use('/api/status', statusRoutes({ db, options: opts }));
  app.use('/api/orders', ordersRoutes({ db, options: opts }));
  // pública (fora do requireAdmin): o login do admin precisa dela ANTES de ter token
  app.use('/api/admin-config', adminConfigRoutes({ options: opts }));
  app.use('/api/admin',
    adminRateLimit({ enabled: opts.rateLimit }),
    requireAdmin({ db, adminEmails: opts.adminEmails }),
    adminRoutes({ db, options: opts }));
  // 5. 404
  app.use('/api', (req, res, next) => next(new AppError('NOT_FOUND', 404, 'Não encontramos o que você procurou.')));
  app.use((req, res) => res.status(404).type('text/plain').send('Página não encontrada'));
  // 6. erros (sempre por último, 4 argumentos)
  app.use(errorHandler);
  return app;
}
