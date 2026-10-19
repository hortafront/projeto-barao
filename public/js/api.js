const NETWORK_MESSAGE = 'Sem conexão. Verifique sua internet e tente de novo.';
const GENERIC_MESSAGE = 'Algo deu errado. Tente novamente.';

/**
 * Chama a API. Nunca rejeita:
 *   { ok: true, status, data } | { ok: false, error: { status, code, message, details } }
 */
export async function request(path, { method = 'GET', body, timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = data?.error ?? {};
      return {
        ok: false,
        error: {
          status: res.status,
          code: err.code ?? 'INTERNAL',
          message: err.message ?? GENERIC_MESSAGE,
          details: err.details,
        },
      };
    }
    return { ok: true, status: res.status, data };
  } catch {
    return { ok: false, error: { status: 0, code: 'NETWORK', message: NETWORK_MESSAGE, details: undefined } };
  } finally {
    clearTimeout(timer);
  }
}

export const getMenu = () => request('/api/menu');
export const getStatus = () => request('/api/status');
export const createOrder = (payload) => request('/api/orders', { method: 'POST', body: payload });
