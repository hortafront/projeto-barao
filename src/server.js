import { createApp } from './app.js';
import { createSupabaseClient } from './db/supabase.js';
import { createRepository } from './db/repositories/index.js';

// Fail fast: nomeia só as variáveis ausentes, nunca imprime valores.
const REQUIRED = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'ADMIN_EMAILS'];
const missing = REQUIRED.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  console.error(JSON.stringify({
    level: 'error',
    msg: `Variáveis de ambiente obrigatórias ausentes: ${missing.join(', ')}. Veja .env.example.`,
  }));
  process.exit(1);
}

const db = createRepository(createSupabaseClient({
  url: process.env.SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
}));

// createApp lê CORS_ORIGIN, ADMIN_EMAILS, STORE_TIMEZONE e TRUST_PROXY do env.
const port = Number(process.env.PORT) || 3000;
createApp({ db }).listen(port, () => {
  console.log(JSON.stringify({ level: 'info', msg: `Barão API na porta ${port}` }));
});
