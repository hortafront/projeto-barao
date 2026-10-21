// Define a nova senha após o link de recuperação do Supabase.
import { el } from './dom.js';
import { getSession, onAuthChange, updatePassword } from './auth.js';
import { passwordError } from './customer-api.js';

const root = document.getElementById('new-password');

function show(...nodes) {
  root.replaceChildren(...nodes);
  root.setAttribute('aria-busy', 'false');
}

function showInvalid() {
  show(
    el('p', { class: 'field-error', role: 'alert' },
      'Link inválido ou expirado. Peça um novo em Entrar → Esqueci minha senha.'),
    el('a', { class: 'btn', href: '/' }, 'Voltar ao cardápio'),
  );
}

function showForm() {
  const password = el('input', { id: 'np-password', type: 'password', autocomplete: 'new-password', required: true, minlength: '8' });
  const confirm = el('input', { id: 'np-confirm', type: 'password', autocomplete: 'new-password', required: true, minlength: '8' });
  const error = el('p', { class: 'field-error', role: 'alert', hidden: true });
  const submit = el('button', { class: 'btn btn--primary', type: 'submit' }, 'Salvar nova senha');
  const form = el('form', { class: 'new-password__form', novalidate: true },
    el('div', { class: 'field' }, el('label', { for: 'np-password' }, 'Nova senha'), password,
      el('span', { class: 'field__hint' }, 'Mínimo de 8 caracteres.')),
    el('div', { class: 'field' }, el('label', { for: 'np-confirm' }, 'Confirmar nova senha'), confirm),
    error, submit);

  const fail = (msg) => { error.textContent = msg; error.hidden = false; };
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    error.hidden = true;
    const invalid = passwordError(password.value, confirm.value);
    if (invalid) return fail(invalid);
    submit.disabled = true;
    try {
      await updatePassword(password.value);
      location.assign('/');
    } catch (err) {
      fail(err.message);
      submit.disabled = false;
    }
  });
  show(el('h1', { class: 'new-password__title' }, 'Criar nova senha'), form);
  password.focus();
}

async function init() {
  let done = false;
  const ready = () => { if (!done) { done = true; showForm(); } };
  try {
    // Assina antes de consultar: PASSWORD_RECOVERY pode chegar durante a inicialização do client.
    await onAuthChange((event) => { if (event === 'PASSWORD_RECOVERY') ready(); });
    if (await getSession()) return ready();
  } catch { /* cai no link inválido */ }
  // O client ainda pode estar processando o hash da URL: dá um respiro antes de desistir.
  setTimeout(() => { if (!done) { done = true; showInvalid(); } }, 1500);
}

init();
