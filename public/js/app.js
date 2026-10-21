// Orquestrador do front do cliente: carrega dados, liga módulos. Sem regra de negócio.
import { getMenu, getStatus } from './api.js';
import * as auth from './auth.js';
import { initAuthDialog } from './auth-dialog.js';
import { createCart } from './cart.js';
import { initCheckout } from './checkout.js';
import { $ } from './dom.js';
import { createLoginGate } from './login-gate.js';
import { renderMenu, renderMenuError, renderMenuLoading, renderStoreStatus } from './menu.js';
import { openPizzaModal } from './product-modal.js';

const STATUS_REFRESH_MS = 60_000;
const TOAST_MS = 3500;

const root = $('#menu');
const tabsRoot = $('#category-tabs');
const statusEls = { badge: $('#store-status'), banner: $('#status-banner') };
const toastEl = $('#toast');
const pizzaDialog = $('#product-modal');
const accountButton = $('#account-button');

const cart = createCart({ storage: globalThis.localStorage });

let menu = null;
let productsById = new Map();
let status = null;
let checkout = null;
let toastTimer = null;

function toast(text) {
  clearTimeout(toastTimer);
  toastEl.textContent = text;
  toastEl.classList.add('is-visible');
  toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), TOAST_MS);
}

// ---------- conta do cliente ----------
const authDialog = initAuthDialog({ dialog: $('#auth-modal'), auth, toast });
const gate = createLoginGate({
  getSession: auth.getSession,
  loadMe: authDialog.loadMe,
  openLogin: () => authDialog.openLogin(),
  openCompleteProfile: authDialog.openCompleteProfile,
});
// Entregue ao checkout (T11) e à tela "Minha conta" (T12).
export const account = {
  gate,
  withAuth: auth.withAuth,
  customerApi: auth.customerApi,
  openLogin: authDialog.openLogin,
  openCompleteProfile: authDialog.openCompleteProfile,
  loadMe: authDialog.loadMe,
};

function paintAccountButton(session) {
  const logged = Boolean(session);
  accountButton.textContent = logged ? 'Minha conta' : 'Entrar';
  accountButton.dataset.logged = String(logged);
}

accountButton.addEventListener('click', () => {
  if (accountButton.dataset.logged === 'true') gate.run(() => {}); // T12 troca por abrir "Minha conta"
  else account.openLogin();
});
auth.getSession().then(paintAccountButton);
auth.onAuthChange((_event, session) => paintAccountButton(session)).catch(() => {});
auth.onSessionLost(() => {
  paintAccountButton(null);
  toast('Sua sessão expirou. Entre novamente.');
});

function indexProducts(data) {
  const map = new Map();
  for (const category of data.categories ?? []) {
    for (const product of category.products ?? []) map.set(product.id, product);
  }
  return map;
}

function storeOpen() {
  return status?.open === true;
}

function addToCart(item, product) {
  const res = cart.add(item);
  if (!res.ok) {
    toast(res.reason === 'CART_FULL' ? 'Seu carrinho está cheio (máx. 30 itens).' : 'Não foi possível adicionar ao carrinho.');
    return;
  }
  checkout?.refresh();
  toast(`${product.name} adicionada`);
}

function paintMenu() {
  renderMenu(root, tabsRoot, menu, {
    storeOpen: storeOpen(),
    onOpenPizza: (product) => openPizzaModal(pizzaDialog, product, {
      menu,
      productsById,
      onAdd: (item) => {
        addToCart(item, product);
      },
    }),
    onAddDrink: (product) => {
      addToCart({ kind: 'drink', productId: product.id, quantity: 1 }, product);
    },
  });
}

function paintStatus() {
  renderStoreStatus(statusEls, status, new Date());
}

/** Carrega menu + status. Devolve true em sucesso; em falha mostra o estado de erro. */
async function load({ fresh = false } = {}) {
  renderMenuLoading(root);
  const [menuRes, statusRes] = await Promise.all([getMenu({ fresh }), getStatus()]);
  if (!menuRes.ok || !statusRes.ok) {
    renderMenuError(root, load);
    return false;
  }
  menu = menuRes.data;
  status = statusRes.data;
  productsById = indexProducts(menu);

  const { removed } = cart.reconcile(productsById);
  if (removed > 0) toast('Alguns itens não estão mais disponíveis e saíram do carrinho.');

  paintMenu();
  paintStatus();

  if (!checkout) {
    checkout = initCheckout({
      cart,
      getProductsById: () => productsById,
      getStatus,
      reloadMenu: () => load({ fresh: true }),
      onStoreClosed: refreshStatus,
    });
  }
  checkout.refresh();
  return true;
}

async function refreshStatus() {
  const res = await getStatus();
  if (!res.ok || !menu) return; // mantém o último estado conhecido
  const wasOpen = storeOpen();
  status = res.data;
  paintStatus();
  if (wasOpen !== storeOpen()) paintMenu();
  checkout?.refresh();
}

load();
setInterval(refreshStatus, STATUS_REFRESH_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshStatus();
});
