// Janela "Entrar / Criar conta" e "Complete seu perfil". Só DOM e orquestração:
// a regra de sessão fica em auth.js e o servidor valida tudo (Zod).
import { el, openDialog, render } from './dom.js';
import { maskPhone, onlyDigits } from './order-payload.js';

const AUTO_LOGIN_FAILED = 'Não foi possível entrar automaticamente.';
const RESET_NOTICE = 'Se houver uma conta com esse e-mail, enviamos um link para criar uma nova senha.';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TABS = [
  { id: 'login', label: 'Entrar' },
  { id: 'signup', label: 'Criar conta' },
];

function field({ id, label, hint, ...attrs }) {
  const input = el('input', { id, name: id, ...attrs });
  return {
    input,
    node: el('div', { class: 'field' },
      el('label', { for: id }, label),
      input,
      hint && el('span', { class: 'field__hint' }, hint)),
  };
}

function profileError(name, phone) {
  const n = name.trim();
  if (n.length < 2 || n.length > 60) return 'Informe seu nome (2 a 60 letras).';
  const digits = onlyDigits(phone);
  if (digits.length < 10 || digits.length > 11) return 'Informe o telefone com DDD, ex.: (85) 99999-9999.';
  return null;
}

export function initAuthDialog({ dialog, auth, toast = () => {} }) {
  async function loadMe() {
    const res = await auth.customerApi('/api/me');
    return res.ok ? res.data : null;
  }

  /** Mantém a janela aberta enquanto `fn` roda: botão desabilitado + texto de espera. */
  async function withBusy(button, busyLabel, idleLabel, fn) {
    button.disabled = true;
    button.textContent = busyLabel;
    try {
      await fn();
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = idleLabel;
      }
    }
  }

  function header(titleId, title, onClose) {
    return el('header', { class: 'sheet__head' },
      el('h2', { id: titleId, class: 'sheet__title' }, title),
      el('button', { type: 'button', class: 'sheet__close', 'aria-label': 'Fechar', onclick: onClose }, '×'));
  }

  // ---------- Entrar / Criar conta ----------
  function openLogin(initialTab = 'login') {
    return new Promise((resolve) => {
      let result = false;
      let view = initialTab; // 'login' | 'signup' | 'forgot'
      let email = '';
      let notice = '';
      let focusTarget = null; // 'tab' | 'first'
      const finish = (value) => { result = value; close(); };

      const close = openDialog(dialog, { onClose: () => resolve(result) });

      function switchTo(next, { keepNotice = false, focus = 'first' } = {}) {
        view = next;
        if (!keepNotice) notice = '';
        focusTarget = focus;
        paint();
      }

      function tabs() {
        const buttons = TABS.map((tab) => el('button', {
          type: 'button',
          role: 'tab',
          id: `auth-tab-${tab.id}`,
          class: 'auth-tabs__tab',
          'aria-selected': String(view === tab.id),
          'aria-controls': 'auth-panel',
          tabindex: view === tab.id ? '0' : '-1',
          onclick: () => switchTo(tab.id, { focus: 'tab' }),
        }, tab.label));
        return el('div', {
          class: 'auth-tabs',
          role: 'tablist',
          'aria-label': 'Entrar ou criar conta',
          onkeydown: (event) => {
            const dir = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
            if (!dir) return;
            event.preventDefault();
            const idx = TABS.findIndex((tab) => tab.id === view);
            switchTo(TABS[(idx + dir + TABS.length) % TABS.length].id, { focus: 'tab' });
          },
        }, buttons);
      }

      function loginForm() {
        const mail = field({ id: 'auth-email', label: 'E-mail', type: 'email', autocomplete: 'email', required: true, value: email });
        const pass = field({ id: 'auth-password', label: 'Senha', type: 'password', autocomplete: 'current-password', required: true });
        const error = el('p', { class: 'field-error', 'aria-live': 'polite' });
        const submit = el('button', { type: 'submit', class: 'btn btn--primary btn--block' }, 'Entrar');
        return el('form', {
          class: 'auth-form',
          novalidate: true,
          onsubmit: async (event) => {
            event.preventDefault();
            error.textContent = '';
            email = mail.input.value.trim();
            if (!EMAIL_RE.test(email)) { error.textContent = 'Informe um e-mail válido.'; mail.input.focus(); return; }
            if (!pass.input.value) { error.textContent = 'Informe sua senha.'; pass.input.focus(); return; }
            await withBusy(submit, 'Entrando…', 'Entrar', async () => {
              try {
                await auth.signIn({ email, password: pass.input.value });
                toast('Você entrou na sua conta.');
                finish(true);
              } catch (err) {
                error.textContent = err.message;
              }
            });
          },
        },
        notice && el('p', { class: 'notice' }, notice),
        mail.node, pass.node, error, submit,
        el('button', {
          type: 'button', class: 'link-btn auth-form__link',
          onclick: () => { email = mail.input.value.trim(); switchTo('forgot'); },
        }, 'Esqueci minha senha'));
      }

      function signupForm() {
        const name = field({ id: 'auth-name', label: 'Nome', type: 'text', autocomplete: 'name', required: true, maxlength: '60' });
        const phone = field({
          id: 'auth-phone', label: 'Telefone (WhatsApp)', type: 'tel', inputmode: 'numeric',
          autocomplete: 'tel-national', placeholder: '(85) 99999-9999', required: true,
          oninput: (event) => { event.target.value = maskPhone(event.target.value); },
        });
        const mail = field({ id: 'auth-email', label: 'E-mail', type: 'email', autocomplete: 'email', required: true, value: email });
        const pass = field({
          id: 'auth-password', label: 'Senha', type: 'password', autocomplete: 'new-password',
          required: true, hint: 'Mínimo de 8 caracteres.',
        });
        const error = el('p', { class: 'field-error', 'aria-live': 'polite' });
        const exists = el('button', {
          type: 'button', class: 'link-btn auth-form__link', hidden: true,
          onclick: () => { email = mail.input.value.trim(); switchTo('login'); },
        }, 'Já tenho conta: entrar com esse e-mail');
        const submit = el('button', { type: 'submit', class: 'btn btn--primary btn--block' }, 'Criar conta');
        return el('form', {
          class: 'auth-form',
          novalidate: true,
          onsubmit: async (event) => {
            event.preventDefault();
            error.textContent = '';
            exists.hidden = true;
            email = mail.input.value.trim();
            const problem = profileError(name.input.value, phone.input.value)
              ?? (EMAIL_RE.test(email) ? null : 'Informe um e-mail válido.')
              ?? (pass.input.value.length >= 8 ? null : 'A senha precisa ter pelo menos 8 caracteres.');
            if (problem) { error.textContent = problem; return; }
            await withBusy(submit, 'Criando conta…', 'Criar conta', async () => {
              try {
                const { profileSaved } = await auth.signUp({
                  name: name.input.value.trim(),
                  phone: onlyDigits(phone.input.value),
                  email,
                  password: pass.input.value,
                });
                toast(profileSaved ? 'Conta criada! Você já está logado.' : 'Conta criada! Falta só completar seu perfil.');
                finish(true);
              } catch (err) {
                if (err.message.startsWith(AUTO_LOGIN_FAILED)) {
                  notice = err.message; // conta criada, mas sem sessão: segue para Entrar com o e-mail preenchido
                  switchTo('login', { keepNotice: true });
                  return;
                }
                error.textContent = err.message;
                exists.hidden = !/Já existe uma conta/.test(err.message);
              }
            });
          },
        }, name.node, phone.node, mail.node, pass.node, error, exists, submit);
      }

      function forgotForm() {
        const mail = field({ id: 'auth-email', label: 'E-mail da sua conta', type: 'email', autocomplete: 'email', required: true, value: email });
        const msg = el('p', { class: 'notice', 'aria-live': 'polite', hidden: true }, RESET_NOTICE);
        const error = el('p', { class: 'field-error', 'aria-live': 'polite' });
        const submit = el('button', { type: 'submit', class: 'btn btn--primary btn--block' }, 'Enviar link');
        return el('form', {
          class: 'auth-form',
          novalidate: true,
          onsubmit: async (event) => {
            event.preventDefault();
            error.textContent = '';
            email = mail.input.value.trim();
            if (!EMAIL_RE.test(email)) { error.textContent = 'Informe um e-mail válido.'; mail.input.focus(); return; }
            await withBusy(submit, 'Enviando…', 'Enviar link', async () => {
              try { await auth.requestPasswordReset(email); } catch { /* não revela se o e-mail existe */ }
              msg.hidden = false; // mesma resposta com ou sem conta
            });
          },
        },
        el('p', { class: 'auth-form__lead' }, 'Informe seu e-mail e enviaremos um link para criar uma nova senha.'),
        mail.node, error, msg, submit,
        el('button', { type: 'button', class: 'link-btn auth-form__link', onclick: () => switchTo('login') }, 'Voltar para entrar'));
      }

      function paint() {
        const forgot = view === 'forgot';
        render(dialog, el('div', { class: 'sheet auth' },
          header('auth-title', forgot ? 'Recuperar senha' : 'Sua conta', () => finish(false)),
          el('div', { class: 'sheet__body' },
            !forgot && tabs(),
            el('div', {
              id: 'auth-panel',
              role: forgot ? undefined : 'tabpanel',
              'aria-labelledby': forgot ? undefined : `auth-tab-${view}`,
            }, forgot ? forgotForm() : (view === 'signup' ? signupForm() : loginForm())))));
        const target = focusTarget === 'tab'
          ? dialog.querySelector('[role="tab"][aria-selected="true"]')
          : dialog.querySelector('.auth-form input');
        focusTarget = null;
        target?.focus();
      }

      paint();
      dialog.querySelector('.auth-form input')?.focus();
    });
  }

  // ---------- Complete seu perfil ----------
  function openCompleteProfile() {
    return new Promise((resolve) => {
      let result = null;
      const close = openDialog(dialog, { onClose: () => resolve(result) });

      const name = field({ id: 'profile-name', label: 'Nome', type: 'text', autocomplete: 'name', required: true, maxlength: '60' });
      const phone = field({
        id: 'profile-phone', label: 'Telefone (WhatsApp)', type: 'tel', inputmode: 'numeric',
        autocomplete: 'tel-national', placeholder: '(85) 99999-9999', required: true,
        oninput: (event) => { event.target.value = maskPhone(event.target.value); },
      });
      const error = el('p', { class: 'field-error', 'aria-live': 'polite' });
      const submit = el('button', { type: 'submit', class: 'btn btn--primary btn--block' }, 'Salvar e continuar');
      const form = el('form', {
        class: 'auth-form',
        novalidate: true,
        onsubmit: async (event) => {
          event.preventDefault();
          error.textContent = '';
          const problem = profileError(name.input.value, phone.input.value);
          if (problem) { error.textContent = problem; return; }
          await withBusy(submit, 'Salvando…', 'Salvar e continuar', async () => {
            const res = await auth.customerApi('/api/me', {
              method: 'PUT',
              body: { name: name.input.value.trim(), phone: onlyDigits(phone.input.value) },
            });
            if (!res.ok) { error.textContent = res.error.message; return; }
            const me = await loadMe();
            if (!me) { error.textContent = 'Não foi possível carregar sua conta. Tente novamente.'; return; }
            result = me;
            close();
          });
        },
      },
      el('p', { class: 'auth-form__lead' }, 'Precisamos do seu nome e telefone para enviar o pedido pelo WhatsApp.'),
      name.node, phone.node, error, submit);

      render(dialog, el('div', { class: 'sheet auth' },
        header('auth-title', 'Complete seu perfil', () => close()),
        el('div', { class: 'sheet__body' }, form)));
      name.input.focus();
    });
  }

  return { openLogin, openCompleteProfile, loadMe };
}
