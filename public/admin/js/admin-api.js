// Cliente da API admin, sem dependência de CDN/DOM (testável com fakes injetados).

export class AdminApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AdminApiError';
    Object.assign(this, { status, code, details });
  }
}

/**
 * adminApi('/api/admin/products')                                  -> GET
 * adminApi(path, { method: 'POST', body: {...} })                  -> JSON
 * adminApi(path, { method: 'POST', body: formData })               -> multipart (sem Content-Type)
 * 401 -> 1 refresh e repete; falhou/401 de novo/sem token -> logout('sessao'). 403 -> logout('acesso').
 * `refreshSession` deve devolver true quando renovou a sessão.
 */
export function createAdminApi({ fetchImpl, getAccessToken, refreshSession, logout }) {
  return async function adminApi(path, { method = 'GET', body, retried = false } = {}) {
    const token = await getAccessToken();
    if (!token) return logout('sessao');

    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';

    let res;
    try {
      res = await fetchImpl(path, {
        method,
        headers,
        body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      });
    } catch {
      throw new AdminApiError(0, 'NETWORK', 'Sem conexão. Nada foi salvo — tente de novo.');
    }

    if (res.status === 401 && !retried) {
      const refreshed = await refreshSession().catch(() => false);
      if (refreshed) return adminApi(path, { method, body, retried: true });
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
  };
}

/** Desabilita o botão, mostra "Salvando…", depois "Salvo ✓" ou o erro; sempre restaura o botão. */
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
