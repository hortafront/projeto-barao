// supabase-js no browser serve APENAS para login/refresh/logout (ANON key).
// Nenhum dado de negócio é lido do Supabase pelo browser: tudo passa pela API Express.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { createAdminApi } from './admin-api.js';

const LOGIN_PAGE = '/admin/';
const PANEL_PAGE = '/admin/painel.html';

let supabasePromise;

/** URL + ANON key vêm do servidor (GET /api/admin-config) — nada hardcoded no repo. */
export function getSupabase() {
  supabasePromise ??= fetch('/api/admin-config')
    .then((res) => {
      if (!res.ok) throw new Error('Falha ao carregar configuração do painel');
      return res.json();
    })
    .then(({ supabaseUrl, supabaseAnonKey }) =>
      createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          storage: window.sessionStorage, // sessão morre ao fechar a aba; nada em localStorage
          storageKey: 'barao-admin-auth',
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      }));
  return supabasePromise;
}

/** Sai e redireciona. A promise nunca resolve: quem fez `await` não segue o fluxo. */
export async function logout(reason) {
  try {
    const supabase = await getSupabase();
    await supabase.auth.signOut();
  } catch { /* segue para o login mesmo assim */ }
  const url = reason ? `${LOGIN_PAGE}?motivo=${encodeURIComponent(reason)}` : LOGIN_PAGE;
  window.location.assign(url);
  return new Promise(() => {});
}

async function getAccessToken() {
  const supabase = await getSupabase();
  const { data } = await supabase.auth.getSession(); // já renova se estiver para expirar
  return data.session?.access_token ?? null;
}

async function refreshSession() {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.refreshSession();
  return !error;
}

export const adminApi = createAdminApi({
  fetchImpl: (...args) => fetch(...args),
  getAccessToken,
  refreshSession,
  logout,
});

/** Login + confirmação na API de que o e-mail está em ADMIN_EMAILS. */
export async function login(email, password) {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error('E-mail ou senha inválidos.'); // genérica: não revela se o e-mail existe
  await adminApi('/api/admin/settings'); // 403 -> logout('acesso') redireciona com a mensagem
  window.location.assign(PANEL_PAGE);
}

/** Chamar no topo de painel.html: sem sessão -> volta ao login. */
export async function requireSession() {
  const supabase = await getSupabase();
  const { data } = await supabase.auth.getSession();
  if (!data.session) await logout('sessao');
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') window.location.assign(LOGIN_PAGE);
  });
  return data.session;
}
