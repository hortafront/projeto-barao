// Entrada das duas páginas do admin: body[data-page="login"] (index.html) e body[data-page="panel"] (painel.html).
import { el, render, $ } from '/js/dom.js';
import { adminApi, login, logout, requireSession } from './auth.js';
import { toast, confirmDialog } from './ui.js';
import { withSaving } from './admin-api.js';

const TABS = [
  { id: 'pedidos', label: 'Pedidos', icon: '🧾', module: './orders.js' },
  { id: 'produtos', label: 'Produtos', icon: '🍕', module: './products.js' },
  { id: 'horarios', label: 'Horários', icon: '🕒', module: './hours.js' },
  { id: 'loja', label: 'Loja', icon: '🏪', module: './store.js' },
  { id: 'resumo', label: 'Resumo', icon: '📊', module: './summary.js' },
];
const DEFAULT_TAB = 'pedidos';

const LOGIN_MESSAGES = {
  sessao: 'Sua sessão expirou. Entre novamente.',
  acesso: 'Este e-mail não tem acesso ao painel.',
};

// ---------------------------------------------------------------- login
function initLogin() {
  const root = $('#login-root');
  const motivo = new URLSearchParams(window.location.search).get('motivo');
  const notice = el('p', { class: 'form-notice', role: 'alert', hidden: !LOGIN_MESSAGES[motivo] }, LOGIN_MESSAGES[motivo] ?? '');
  const email = el('input', { id: 'email', name: 'email', type: 'email', autocomplete: 'username', required: true });
  const password = el('input', { id: 'password', name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const submit = el('button', { type: 'submit', class: 'btn btn--primary btn--block' }, 'Entrar');

  const form = el('form', { class: 'login-form', novalidate: true },
    el('div', { class: 'form-row' }, el('label', { for: 'email' }, 'E-mail'), email),
    el('div', { class: 'form-row' }, el('label', { for: 'password' }, 'Senha'), password),
    notice,
    submit);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    notice.hidden = true;
    submit.disabled = true;
    submit.textContent = 'Entrando…';
    try {
      await login(email.value.trim(), password.value);
    } catch (err) {
      notice.textContent = err.message || 'E-mail ou senha inválidos.';
      notice.hidden = false;
      submit.disabled = false;
      submit.textContent = 'Entrar';
    }
  });

  render(root,
    el('h1', { class: 'login__title' }, 'Painel Barão'),
    form);
}

// ---------------------------------------------------------------- painel
function currentTab() {
  const id = window.location.hash.slice(1);
  return TABS.some((t) => t.id === id) ? id : DEFAULT_TAB;
}

async function initPanel() {
  await requireSession();

  const banner = el('div', { class: 'override-banner', role: 'status', hidden: true });
  const content = el('main', { id: 'tab-content', class: 'admin-main', tabindex: '-1' });
  const buttons = new Map();
  const nav = el('nav', { class: 'bottom-nav', 'aria-label': 'Seções do painel' },
    TABS.map((tab) => {
      const link = el('a', { href: `#${tab.id}`, class: 'bottom-nav__item', dataset: { tab: tab.id } },
        el('span', { class: 'bottom-nav__icon', 'aria-hidden': 'true' }, tab.icon),
        el('span', { class: 'bottom-nav__label' }, tab.label));
      buttons.set(tab.id, link);
      return link;
    }));
  const logoutBtn = el('button', { type: 'button', class: 'btn btn--small', onclick: () => logout() }, 'Sair');

  render($('#panel-root'),
    el('header', { class: 'admin-header' }, el('span', { class: 'wordmark' }, 'Barão'), el('span', { class: 'admin-header__tag' }, 'Painel'), logoutBtn),
    banner, content, nav);

  async function refreshBanner() {
    try {
      const settings = await adminApi('/api/admin/settings');
      const mode = settings?.storeOverride;
      banner.hidden = mode !== 'open' && mode !== 'closed';
      banner.className = `override-banner${mode === 'open' ? ' override-banner--open' : ''}`;
      banner.textContent = mode === 'closed' ? 'Loja forçada FECHADA' : mode === 'open' ? 'Loja forçada ABERTA' : '';
    } catch { /* faixa é informativa; a tela mostra o próprio erro */ }
  }

  const ctx = { adminApi, toast, confirmDialog, withSaving, refreshBanner };
  let token = 0;

  async function show() {
    const id = currentTab();
    const mine = ++token;
    for (const [tabId, link] of buttons) {
      if (tabId === id) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    render(content, el('div', { class: 'skeleton' }));
    refreshBanner();
    try {
      const mod = await import(TABS.find((t) => t.id === id).module);
      if (mine !== token) return; // usuário já trocou de aba
      render(content);
      await mod.mount(content, ctx);
    } catch (err) {
      if (mine !== token) return;
      render(content, el('p', { class: 'field-error', role: 'alert' }, err?.message || 'Não foi possível carregar esta seção.'));
    }
  }

  window.addEventListener('hashchange', show);
  if (!window.location.hash) window.history.replaceState(null, '', `#${DEFAULT_TAB}`);
  show();
}

async function startPanel() {
  try {
    await initPanel();
  } catch {
    render($('#panel-root'),
      el('p', { class: 'field-error', role: 'alert' }, 'Não foi possível carregar o painel. Verifique sua conexão e tente de novo.'),
      el('button', { type: 'button', class: 'btn', onclick: () => window.location.reload() }, 'Recarregar'));
  }
}

const page = document.body.dataset.page;
if (page === 'login') initLogin();
else if (page === 'panel') startPanel();
