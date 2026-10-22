// Sessão do cliente. supabase-js (CDN, ANON key) serve APENAS para cadastro/login/refresh/logout;
// dados de negócio passam sempre pela API Express (customerApi com Bearer).
import { request } from './api.js';
import {
  createCustomerApi, authErrorMessage, passwordError, CUSTOMER_STORAGE_KEY,
} from './customer-api.js';

const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

let supabasePromise;
const lostListeners = new Set();

/** URL + ANON key vêm do servidor (GET /api/admin-config). O CDN só é baixado quando precisa. */
export function getSupabase() {
  supabasePromise ??= Promise.all([
    import(SUPABASE_CDN),
    fetch('/api/admin-config').then((res) => {
      if (!res.ok) throw new Error('Falha ao carregar configuração da conta');
      return res.json();
    }),
  ])
    .then(([{ createClient }, { supabaseUrl, supabaseAnonKey }]) =>
      createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          storage: window.localStorage,
          storageKey: CUSTOMER_STORAGE_KEY,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: location.pathname.startsWith('/conta/nova-senha'),
        },
      }))
    .catch((err) => {
      supabasePromise = undefined; // não guardar promessa rejeitada: a próxima tentativa refaz tudo
      throw err;
    });
  return supabasePromise;
}

async function getAccessToken() {
  try {
    const { data } = await (await getSupabase()).auth.getSession(); // já renova se estiver para expirar
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function refreshSession() {
  const { error } = await (await getSupabase()).auth.refreshSession();
  return !error;
}

export function onSessionLost(fn) {
  lostListeners.add(fn);
  return () => lostListeners.delete(fn);
}

export const { customerApi, withAuth } = createCustomerApi({
  request,
  getAccessToken,
  refreshSession,
  onSessionLost: () => lostListeners.forEach((fn) => fn()),
});

/** Erros do Supabase saem como Error com mensagem PT-BR. */
async function authCall(fn) {
  let result;
  try {
    result = await fn(await getSupabase());
  } catch (err) {
    throw new Error(authErrorMessage(err));
  }
  if (result.error) throw new Error(authErrorMessage(result.error));
  return result.data;
}

/** Há sessão salva neste navegador? Barato: não toca no supabase-js (nem baixa o CDN). */
export function hasStoredSession(storage) {
  try {
    return Boolean((storage ?? globalThis.localStorage)?.getItem(CUSTOMER_STORAGE_KEY));
  } catch {
    return false;
  }
}

export async function getSession() {
  try {
    const { data } = await (await getSupabase()).auth.getSession();
    return data.session ?? null;
  } catch {
    return null;
  }
}

export async function signUp({ name, phone, email, password }) {
  const invalid = passwordError(password);
  if (invalid) throw new Error(invalid);
  const data = await authCall((s) => s.auth.signUp({ email, password }));
  if (!data.session) {
    throw new Error('Não foi possível entrar automaticamente. Tente entrar com seu e-mail e senha.');
  }
  const res = await customerApi('/api/me', { method: 'PUT', body: { name, phone } });
  return { profileSaved: res.ok }; // falha do PUT não desfaz o cadastro
}

export async function signIn({ email, password }) {
  const data = await authCall((s) => s.auth.signInWithPassword({ email, password }));
  return data.session;
}

export async function signOut({ scope } = {}) {
  try {
    await (await getSupabase()).auth.signOut(scope ? { scope } : undefined);
  } catch { /* sessão local some mesmo assim no próximo getSession */ }
}

export async function requestPasswordReset(email) {
  await authCall((s) => s.auth.resetPasswordForEmail(email, {
    redirectTo: `${location.origin}/conta/nova-senha.html`,
  }));
}

export async function updatePassword(newPassword) {
  const invalid = passwordError(newPassword);
  if (invalid) throw new Error(invalid);
  await authCall((s) => s.auth.updateUser({ password: newPassword }));
}

/** fn(event, session). Devolve função para cancelar. */
export async function onAuthChange(fn) {
  const supabase = await getSupabase();
  const { data } = supabase.auth.onAuthStateChange((event, session) => fn(event, session));
  return () => data.subscription.unsubscribe();
}
