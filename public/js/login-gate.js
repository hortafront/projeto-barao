// Login gate: exige conta (e perfil completo) antes de uma ação e a retoma depois de entrar.
// Puro: sem DOM nem rede; tudo entra por injeção.

/** Conta sem perfil (nome/telefone) ainda precisa ser completada. */
export function needsProfile(me) {
  return !me?.profile;
}

export function createLoginGate({ getSession, loadMe, openLogin, openCompleteProfile }) {
  let pendingLogin = null; // vários run() simultâneos compartilham uma única janela de login

  function login() {
    pendingLogin ??= Promise.resolve(openLogin()).finally(() => { pendingLogin = null; });
    return pendingLogin;
  }

  /** Roda action(me) com sessão e perfil garantidos. Resolve true se a ação rodou, false se foi interrompida. */
  async function run(action) {
    if (!(await getSession())) {
      if (!(await login())) return false;
    }
    let me = await loadMe();
    if (!me) return false;
    if (needsProfile(me)) {
      me = await openCompleteProfile(me);
      if (!me) return false;
    }
    await action(me);
    return true;
  }

  return { run };
}
