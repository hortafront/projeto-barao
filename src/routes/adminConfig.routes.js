import express from 'express';

/** GET /api/admin-config → { supabaseUrl, supabaseAnonKey }. Pública, sem auth, cache curto. Nunca a service role. */
export function adminConfigRoutes({ options }) {
  const router = express.Router();
  router.get('/', (req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ supabaseUrl: options.supabaseUrl, supabaseAnonKey: options.supabaseAnonKey });
  });
  return router;
}
