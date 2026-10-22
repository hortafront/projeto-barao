// Cardápio do cliente: abas, seções, cards, estados de carregamento/erro e selo da loja.
// Só `el()` para montar DOM (nada de innerHTML); sem regra de negócio — preços vêm prontos da API.
import { formatBRL } from '/shared/money.js';
import { el, render } from './dom.js';

const STORE_TZ = 'America/Fortaleza';
const HIDDEN_CATEGORY_SLUG = 'adicionais'; // addons só aparecem dentro do modal da pizza
const SKELETON_CARDS = 4;
const SVG_NS = 'http://www.w3.org/2000/svg';

let tabsObserver = null;

// ---------- Horário da loja (funções puras, sempre no fuso de Fortaleza) ----------

function localParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: STORE_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

const pad2 = (n) => String(n).padStart(2, '0');

/** 'hoje às 18:00' | 'amanhã às 18:00' | 'quinta às 18:00'. */
export function describeNextOpening(nextOpenAt, now = new Date()) {
  const target = new Date(nextOpenAt);
  const a = localParts(now);
  const b = localParts(target);
  const diffDays = Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000,
  );
  const time = `${pad2(b.hour)}:${pad2(b.minute)}`;
  if (diffDays === 0) return `hoje às ${time}`;
  if (diffDays === 1) return `amanhã às ${time}`;
  const day = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: STORE_TZ })
    .format(target).replace(/-feira$/, '');
  return `${day} às ${time}`;
}

/** Texto do banner de loja fechada; null quando aberta (ou sem status). */
export function storeBannerText(status, now = new Date()) {
  if (!status || status.open) return null;
  if (status.reason !== 'override_closed' && status.nextOpenAt) {
    return `Estamos fechados agora — abrimos ${describeNextOpening(status.nextOpenAt, now)}.`;
  }
  return 'Estamos fechados no momento.';
}

/** Atualiza o selo do header e o banner de aviso. `status` null = ainda desconhecido. */
export function renderStoreStatus({ badge, banner }, status, now = new Date()) {
  if (badge) {
    const known = status != null;
    badge.className = `badge status-badge${known ? (status.open ? ' badge--open' : ' badge--closed') : ''}`;
    badge.textContent = !known ? 'Verificando…' : (status.open ? 'Aberto agora' : 'Fechado');
  }
  if (!banner) return;
  const text = storeBannerText(status, now);
  banner.hidden = text == null;
  if (text == null) {
    banner.removeAttribute('role');
    banner.removeAttribute('aria-live');
    banner.replaceChildren();
    return;
  }
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  banner.replaceChildren(el('p', { class: 'status-banner__text' }, text));
}

// ---------- Cards ----------

function placeholder(kind) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'product-card__img product-card__img--placeholder');
  svg.setAttribute('width', '88');
  svg.setAttribute('height', '88');
  svg.setAttribute('viewBox', '0 0 88 88');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', kind === 'drink' ? '#ph-drink' : '#ph-pizza');
  svg.append(use);
  return svg;
}

function productThumb(product) {
  if (!product.imageUrl) return placeholder(product.kind);
  const img = el('img', {
    class: 'product-card__img', src: product.imageUrl, alt: '',
    width: 88, height: 88, loading: 'lazy', decoding: 'async',
  });
  img.addEventListener('error', () => img.replaceWith(placeholder(product.kind)), { once: true });
  return img;
}

function productCard(product, { storeOpen, onOpenPizza, onAddDrink }) {
  const soldOut = product.available === false;
  const closed = !storeOpen;
  const action = product.kind === 'pizza' ? () => onOpenPizza?.(product) : () => onAddDrink?.(product);
  const label = soldOut ? `${product.name} esgotado` : `Adicionar ${product.name}`;
  return el('article', { class: `product-card${soldOut ? ' is-soldout' : ''}` },
    el('div', { class: 'product-card__media' }, productThumb(product)),
    el('div', { class: 'product-card__body' },
      el('h3', { class: 'product-card__name' }, product.name),
      product.description && el('p', { class: 'product-card__desc' }, product.description),
      el('div', { class: 'product-card__footer' },
        el('span', { class: 'price product-card__price' }, formatBRL(product.priceCents)),
        soldOut && el('span', { class: 'badge badge--soldout' }, 'Esgotado'),
        el('button', {
          type: 'button',
          class: 'btn-icon product-card__add',
          disabled: soldOut || closed,
          'aria-label': label,
          title: !soldOut && closed ? 'Loja fechada no momento' : null,
          onclick: soldOut || closed ? null : action,
        }, '+'))));
}

// ---------- Promoção do dia ----------

function comboCard(combo, { storeOpen, onOpenCombo }) {
  const soldOut = combo.available === false;
  const closed = !storeOpen;
  return el('article', { class: `product-card combo-card${soldOut ? ' is-soldout' : ''}` },
    el('div', { class: 'product-card__media' }, productThumb({ ...combo, kind: 'pizza' })),
    el('div', { class: 'product-card__body' },
      el('span', { class: 'badge combo-card__badge' }, 'Promoção do dia'),
      el('h3', { class: 'product-card__name', id: 'promo-dia-title' }, combo.name),
      combo.description && el('p', { class: 'product-card__desc' }, combo.description),
      el('ul', { class: 'combo-card__slots' }, (combo.slots ?? []).map((slot) => el('li', {}, slot.label))),
      el('div', { class: 'product-card__footer' },
        el('span', { class: 'price product-card__price' }, formatBRL(combo.priceCents)),
        el('button', {
          type: 'button',
          class: 'btn btn--primary combo-card__cta',
          disabled: soldOut || closed,
          title: !soldOut && closed ? 'Loja fechada no momento' : null,
          onclick: soldOut || closed ? null : () => onOpenCombo?.(combo),
        }, soldOut ? 'Esgotado hoje' : 'Montar combo'))));
}

function comboSection(combo, opts) {
  return el('section', { class: 'menu-section combo-section', id: 'promo-dia', 'aria-labelledby': 'promo-dia-title' },
    comboCard(combo, opts));
}

// ---------- Abas e seções ----------

function visibleCategories(menu) {
  return [...(menu?.categories ?? [])]
    .filter((c) => c.slug !== HIDDEN_CATEGORY_SLUG && (c.products ?? []).length > 0)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

function setActiveTab(tabsRoot, id) {
  for (const tab of tabsRoot.querySelectorAll('a')) {
    const active = tab.dataset.target === id;
    if (active) tab.setAttribute('aria-current', 'true');
    else tab.removeAttribute('aria-current');
    if (active && typeof tab.scrollIntoView === 'function') {
      tab.scrollIntoView({ inline: 'center', block: 'nearest' });
    }
  }
}

function observeSections(root, tabsRoot) {
  tabsObserver?.disconnect();
  tabsObserver = null;
  if (typeof IntersectionObserver !== 'function') return;
  const sections = [...root.querySelectorAll('section[id]')];
  if (sections.length === 0) return;
  // faixa de detecção logo abaixo do header + abas
  tabsObserver = new IntersectionObserver((entries) => {
    const visible = entries.filter((e) => e.isIntersecting);
    if (visible.length === 0) return;
    visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    setActiveTab(tabsRoot, visible[0].target.id);
  }, { rootMargin: '-120px 0px -60% 0px', threshold: 0 });
  for (const section of sections) tabsObserver.observe(section);
}

export function renderMenu(root, tabsRoot, menu, { storeOpen = false, onOpenPizza, onAddDrink, combo = null, onOpenCombo } = {}) {
  const categories = visibleCategories(menu);
  const opts = { storeOpen, onOpenPizza, onAddDrink };

  render(tabsRoot, categories.map((category, index) => el('a', {
    class: 'category-tab',
    href: `#cat-${category.slug}`,
    dataset: { target: `cat-${category.slug}` },
    'aria-current': index === 0 ? 'true' : null,
    onclick: () => setActiveTab(tabsRoot, `cat-${category.slug}`),
  }, category.name)));

  render(root, [combo && comboSection(combo, { storeOpen, onOpenCombo }), ...categories.map((category) => {
    const products = [...category.products].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    return el('section', {
      class: 'menu-section', id: `cat-${category.slug}`, 'aria-labelledby': `cat-${category.slug}-title`,
    },
    el('h2', { class: 'menu-section__title', id: `cat-${category.slug}-title` }, category.name),
    el('div', { class: 'menu-section__grid' }, products.map((p) => productCard(p, opts))));
  })]);

  root.setAttribute('aria-busy', 'false');
  observeSections(root, tabsRoot);
}

// ---------- Estados ----------

export function renderMenuLoading(root) {
  tabsObserver?.disconnect();
  tabsObserver = null;
  root.setAttribute('aria-busy', 'true');
  render(root, el('div', { class: 'menu-loading', role: 'status', 'aria-label': 'Carregando cardápio' },
    Array.from({ length: SKELETON_CARDS }, () => el('div', { class: 'skeleton skeleton--card', 'aria-hidden': 'true' }))));
}

export function renderMenuError(root, onRetry) {
  tabsObserver?.disconnect();
  tabsObserver = null;
  root.setAttribute('aria-busy', 'false');
  render(root, el('div', { class: 'menu-error', role: 'alert' },
    el('p', { class: 'menu-error__text' }, 'Não conseguimos carregar o cardápio. Verifique sua internet.'),
    el('button', { type: 'button', class: 'btn btn--primary', onclick: () => onRetry?.() }, 'Tentar de novo')));
}
