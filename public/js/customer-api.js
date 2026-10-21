// Sessão do cliente sem dependência de CDN/DOM (testável com fakes injetados).

export const CUSTOMER_STORAGE_KEY = 'barao-cliente-auth';
export const SESSION_LOST = Object.freeze({
  status: 401,
  code: 'UNAUTHORIZED',
  message: 'Entre na sua conta para continuar.',
});

const MSG = {
  invalid: 'E-mail ou senha incorretos.',
  exists: 'Já existe uma conta com esse e-mail. Quer entrar?',
  weak: 'A senha precisa ter pelo menos 8 caracteres.',
  network: 'Sem conexão. Verifique sua internet e tente de novo.',
  rate: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  generic: 'Algo deu errado. Tente novamente.',
  mismatch: 'As senhas não conferem.',
};

/** Traduz um erro do supabase-js auth para PT-BR. */
export function authErrorMessage(error) {
  const code = error?.code;
  if (code === 'invalid_credentials') return MSG.invalid;
  if (code === 'user_already_exists' || /already registered/i.test(error?.message ?? '')) return MSG.exists;
  if (code === 'weak_password') return MSG.weak;
  if (error?.name === 'AuthRetryableFetchError' || error?.status === 0) return MSG.network;
  if (error?.status === 429) return MSG.rate;
  return MSG.generic;
}

export function passwordError(password, confirm) {
  if (typeof password !== 'string' || password.length < 8) return MSG.weak;
  if (confirm !== undefined && confirm !== password) return MSG.mismatch;
  return null;
}

/**
 * withAuth(call) -> chama call(token). 401 -> 1 refresh e repete uma vez;
 * sem token / refresh falhou / 401 de novo -> onSessionLost() 1x e SESSION_LOST.
 * Qualquer outro resultado (400, 409, NETWORK...) passa direto.
 */
export function createCustomerApi({ request, getAccessToken, refreshSession, onSessionLost }) {
  const lost = () => {
    onSessionLost?.();
    return { ok: false, error: SESSION_LOST };
  };
  const isUnauthorized = (res) => !res.ok && res.error?.status === 401;

  async function withAuth(call) {
    const token = await getAccessToken();
    if (!token) return lost();
    const first = await call(token);
    if (!isUnauthorized(first)) return first;

    const refreshed = await Promise.resolve().then(refreshSession).catch(() => false);
    if (!refreshed) return lost();
    const newToken = await getAccessToken();
    if (!newToken) return lost();
    const second = await call(newToken);
    return isUnauthorized(second) ? lost() : second;
  }

  const customerApi = (path, opts = {}) => withAuth((token) => request(path, { ...opts, token }));

  return { withAuth, customerApi };
}
