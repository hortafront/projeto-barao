// Implementação de referência de public/admin/js/auth.js + public/admin/js/admin-api.js
// (pode ser um arquivo só ou dois; aqui estão juntos para leitura).
//
// supabase-js no browser serve APENAS para login/refresh/logout (ANON key).
// Nenhum dado de negócio é lido do Supabase pelo browser: tudo passa pela API Express.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const LOGIN_PAGE = '/admin/';
const PANEL_PAGE = '/admin/painel.html';

// ---------------------------------------------------------------- cliente Supabase
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

// ---------------------------------------------------------------- sessão
export async function login(email, password) {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Mensagem genérica: não revelar se o e-mail existe.
    throw new Error('E-mail ou senha inválidos.');
  }
  // Confirma na API que o e-mail está em ADMIN_EMAILS antes de entrar no painel.
  await adminApi('/api/admin/settings');
  window.location.assign(PANEL_PAGE);
}

/** Sai e redireciona. A promise nunca resolve: quem fez `await` para ali (evita seguir o fluxo). */
export async function logout(reason) {
  const supabase = await getSupabase();
  await supabase.auth.signOut().catch(() => {});
  const url = reason ? `${LOGIN_PAGE}?motivo=${encodeURIComponent(reason)}` : LOGIN_PAGE;
  window.location.assign(url);
  return new Promise(() => {});
}

/** Chamar no topo de painel.html: sem sessão → volta ao login. */
export async function requireSession() {
  const supabase = await getSupabase();
  const { data } = await supabase.auth.getSession();
  if (!data.session) await logout('sessao');
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') window.location.assign(LOGIN_PAGE);
  });
  return data.session;
}

async function accessToken() {
  const supabase = await getSupabase();
  const { data } = await supabase.auth.getSession(); // já renova se estiver para expirar
  return data.session?.access_token ?? null;
}

// ---------------------------------------------------------------- API
export class AdminApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    Object.assign(this, { status, code, details });
  }
}

/**
 * adminApi('/api/admin/products')                                   → GET
 * adminApi('/api/admin/products', { method: 'POST', body: {...} })   → JSON
 * adminApi(`/api/admin/products/${id}/image`, { method: 'POST', body: formData }) → multipart
 * 401 → tenta 1 refresh e repete; se falhar, logout. 403 → logout com motivo "acesso".
 */
export async function adminApi(path, { method = 'GET', body, retried = false } = {}) {
  const token = await accessToken();
  if (!token) return logout('sessao');

  const isForm = body instanceof FormData;
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  // Em FormData NÃO definir Content-Type: o browser põe o boundary.

  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw new AdminApiError(0, 'NETWORK', 'Sem conexão. Nada foi salvo — tente de novo.');
  }

  if (res.status === 401 && !retried) {
    const supabase = await getSupabase();
    const { error } = await supabase.auth.refreshSession();
    if (!error) return adminApi(path, { method, body, retried: true });
  }
  if (res.status === 401) return logout('sessao');
  if (res.status === 403) return logout('acesso');

  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new AdminApiError(res.status, err.code ?? 'INTERNAL', err.message ?? 'Erro inesperado. Tente novamente.', err.details);
  }
  return data;
}

// ---------------------------------------------------------------- feedback de salvamento
/**
 * Envolve uma ação de salvar: desabilita o botão, mostra "Salvando…", depois "Salvo ✓" ou o erro.
 *   button.addEventListener('click', () => withSaving(button, () => adminApi(...)));
 */
export async function withSaving(button, action, { toast } = {}) {
  const label = button.textContent;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = 'Salvando…';
  try {
    const result = await action();
    toast?.('Salvo ✓', 'success');
    return result;
  } catch (err) {
    toast?.(err.message ?? 'Não foi possível salvar.', 'error');
    throw err;
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.textContent = label;
  }
}
