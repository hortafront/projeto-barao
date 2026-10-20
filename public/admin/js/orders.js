// Tela Pedidos do painel: filtro por data (fuso America/Fortaleza), lista, detalhe e mudança de status.
// Só `el()` para montar DOM; dados do cliente entram sempre como texto.
import { formatBRL } from '/shared/money.js';
import { el, render, openDialog } from '../../js/dom.js';

const TZ = 'America/Fortaleza';

export const STATUS_LABEL = { received: 'Recebido', confirmed: 'Confirmado', canceled: 'Cancelado' };
const FULFILLMENT_LABEL = { delivery: 'Entrega', pickup: 'Retirada' };
const PAYMENT_LABEL = { pix: 'Pix', cash: 'Dinheiro', card: 'Cartão' };

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});
const timeFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** Data de calendário em Fortaleza como 'YYYY-MM-DD' (nunca o dia UTC). */
export function todayInFortaleza(date = new Date()) {
  const parts = Object.fromEntries(dateFmt.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftDays(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 'hoje' | 'ontem' | '7dias' | 'mes' -> { from, to } ('YYYY-MM-DD', inclusivo). */
export function presetRange(preset, now = new Date()) {
  const today = todayInFortaleza(now);
  switch (preset) {
    case 'hoje': return { from: today, to: today };
    case 'ontem': { const y = shiftDays(today, -1); return { from: y, to: y }; }
    case '7dias': return { from: shiftDays(today, -6), to: today };
    case 'mes': return { from: `${today.slice(0, 8)}01`, to: today };
    default: throw new RangeError(`presetRange: período desconhecido "${preset}"`);
  }
}

/** ISO UTC -> 'HH:MM' em Fortaleza. */
export function formatTimeFortaleza(iso) {
  return timeFmt.format(new Date(iso));
}

function formatDateBR(ymd) {
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

function formatPhone(digits) {
  const d = String(digits ?? '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

function statusPill(status) {
  return el('span', { class: `status-pill status-pill--${status}` }, STATUS_LABEL[status] ?? status);
}

/** Barra De/Até + atalhos; chama onChange({from,to}) quando muda. Reutilizada pelo Resumo. */
export function dateFilter({ range, presets, onChange }) {
  const from = el('input', { type: 'date', id: 'filter-from', value: range.from });
  const to = el('input', { type: 'date', id: 'filter-to', value: range.to });
  const error = el('p', { class: 'field-error', role: 'alert', hidden: true });

  function apply(next) {
    if (!next.from || !next.to || next.from > next.to) {
      error.textContent = 'Informe um período válido: a data inicial não pode ser depois da final.';
      error.hidden = false;
      return;
    }
    error.hidden = true;
    from.value = next.from;
    to.value = next.to;
    onChange(next);
  }

  const shortcuts = presets.map(([label, key]) =>
    el('button', { type: 'button', class: 'btn btn--small', onclick: () => apply(presetRange(key, new Date())) }, label));

  const node = el('div', { class: 'date-filter' },
    el('div', { class: 'form-row' }, el('label', { for: 'filter-from' }, 'De'), from),
    el('div', { class: 'form-row' }, el('label', { for: 'filter-to' }, 'Até'), to),
    el('div', { class: 'date-filter__shortcuts' }, shortcuts),
    error);
  const onInput = () => apply({ from: from.value, to: to.value });
  from.addEventListener('change', onInput);
  to.addEventListener('change', onInput);
  return node;
}

export async function mount(container, ctx) {
  const { adminApi, toast, confirmDialog, withSaving } = ctx;
  const state = { range: presetRange('hoje', new Date()), page: 1, orders: [], total: 0, loading: false };
  let requestId = 0;

  const listNode = el('div', { class: 'admin-list', 'aria-live': 'polite' });
  const moreBtn = el('button', { type: 'button', class: 'btn btn--block', hidden: true, onclick: () => load(false) }, 'Carregar mais');
  const errorNode = el('p', { class: 'field-error', role: 'alert', hidden: true });
  const countNode = el('p', { class: 'admin-note' });
  const refreshBtn = el('button', { type: 'button', class: 'btn btn--small', onclick: () => load(true) }, 'Atualizar');

  const filter = dateFilter({
    range: state.range,
    presets: [['Hoje', 'hoje'], ['Ontem', 'ontem'], ['7 dias', '7dias']],
    onChange: (range) => { state.range = range; load(true); },
  });

  render(container,
    el('h1', {}, 'Pedidos'),
    filter,
    el('div', { class: 'form-row--inline' }, refreshBtn, countNode),
    errorNode, listNode, moreBtn);

  function orderCard(order) {
    return el('button', {
      type: 'button',
      class: 'admin-card admin-card--clickable',
      dataset: { orderId: order.id },
      onclick: () => openDetail(order.id),
    },
    el('div', { class: 'admin-list__main' },
      el('div', { class: 'admin-list__title' }, `${order.code} · ${formatTimeFortaleza(order.createdAt)}`),
      el('div', {}, order.customerName),
      el('div', { class: 'admin-list__meta' },
        `${FULFILLMENT_LABEL[order.fulfillment] ?? order.fulfillment} · ${PAYMENT_LABEL[order.paymentMethod] ?? order.paymentMethod}`),
      el('div', {}, order.status === 'canceled' ? el('s', {}, formatBRL(order.subtotalCents)) : el('strong', {}, formatBRL(order.subtotalCents)))),
    statusPill(order.status));
  }

  function paint() {
    if (state.orders.length === 0) {
      render(listNode, state.loading ? el('div', { class: 'skeleton' })
        : el('p', { class: 'admin-note' }, `Nenhum pedido em ${formatDateBR(state.range.from)}${state.range.to !== state.range.from ? ` a ${formatDateBR(state.range.to)}` : ''}.`));
    } else {
      render(listNode, state.orders.map(orderCard));
    }
    countNode.textContent = state.total ? `${state.orders.length} de ${state.total} pedidos` : '';
    moreBtn.hidden = state.orders.length >= state.total;
  }

  async function load(reset) {
    const mine = ++requestId;
    if (reset) { state.page = 1; state.orders = []; state.total = 0; }
    else state.page += 1;
    state.loading = true;
    errorNode.hidden = true;
    refreshBtn.disabled = true;
    moreBtn.disabled = true;
    if (reset) paint();
    try {
      const q = new URLSearchParams({ from: state.range.from, to: state.range.to, page: String(state.page) });
      const data = await adminApi(`/api/admin/orders?${q}`);
      if (mine !== requestId) return;
      state.orders = reset ? data.orders : [...state.orders, ...data.orders];
      state.total = data.total;
    } catch (err) {
      if (mine !== requestId) return;
      if (!reset) state.page -= 1;
      errorNode.textContent = err.message || 'Não foi possível carregar os pedidos.';
      errorNode.hidden = false;
    } finally {
      if (mine === requestId) {
        state.loading = false;
        refreshBtn.disabled = false;
        moreBtn.disabled = false;
        paint();
      }
    }
  }

  async function setStatus(order, status, button) {
    const { order: updated } = await withSaving(button, () =>
      adminApi(`/api/admin/orders/${order.id}/status`, { method: 'PATCH', body: { status } }), { toast });
    const idx = state.orders.findIndex((o) => o.id === updated.id);
    if (idx >= 0) state.orders[idx] = { ...state.orders[idx], status: updated.status };
    paint();
    return updated;
  }

  async function openDetail(id) {
    let order;
    try {
      ({ order } = await adminApi(`/api/admin/orders/${id}`));
    } catch (err) {
      toast(err.message || 'Não foi possível abrir o pedido.', 'error');
      return;
    }
    const body = el('div', { class: 'order-detail' });
    const dialog = el('dialog', { class: 'modal order-dialog', 'aria-labelledby': 'order-title' }, body);
    document.body.append(dialog);
    const closeBtn = el('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Fechar');
    const close = openDialog(dialog, { initialFocus: closeBtn, onClose: () => dialog.remove() });

    function paintDetail() {
      const actions = [];
      const act = (label, status, { danger = false, confirm } = {}) => el('button', {
        type: 'button',
        class: danger ? 'btn btn--danger' : status === 'confirmed' ? 'btn btn--primary' : 'btn',
        onclick: async (ev) => {
          if (confirm && !(await confirmDialog(confirm))) return;
          try { order = { ...order, ...(await setStatus(order, status, ev.currentTarget)) }; } catch { return; }
          paintDetail();
        },
      }, label);
      if (order.status === 'received') {
        actions.push(act('Confirmar', 'confirmed'));
      }
      if (order.status !== 'canceled') {
        actions.push(act('Cancelar pedido', 'canceled', {
          danger: true,
          confirm: { title: `Cancelar o pedido ${order.code}?`, body: 'O pedido ficará marcado como cancelado e não entra no resumo.', confirmLabel: 'Cancelar pedido', danger: true },
        }));
      }
      if (order.status !== 'received') {
        actions.push(act('Voltar para recebido', 'received'));
      }

      const delivery = order.fulfillment === 'delivery';
      render(body,
        el('h2', { id: 'order-title' }, `${order.code} · ${formatTimeFortaleza(order.createdAt)}`),
        statusPill(order.status),
        el('p', {}, el('strong', {}, order.customerName), ' · ',
          el('a', { href: `tel:+55${order.customerPhone}` }, formatPhone(order.customerPhone))),
        el('a', { class: 'btn btn--small', href: `https://wa.me/55${order.customerPhone}`, target: '_blank', rel: 'noopener noreferrer' }, 'Abrir conversa'),
        el('p', {}, FULFILLMENT_LABEL[order.fulfillment] ?? order.fulfillment),
        delivery ? el('p', {}, `${order.addressStreet}, ${order.addressNumber} — ${order.addressDistrict}`) : null,
        delivery && order.addressReference ? el('p', { class: 'admin-list__meta' }, `Referência: ${order.addressReference}`) : null,
        el('ul', { class: 'order-items' }, (order.items ?? []).map((item) =>
          el('li', {},
            el('div', {}, `${item.quantity}× ${item.description}`),
            item.flavorNames?.length ? el('div', { class: 'admin-list__meta' }, `Sabores: ${item.flavorNames.join(' / ')}`) : null,
            ...(item.addons ?? []).map((a) => el('div', { class: 'admin-list__meta' }, `+ ${a.name} (${formatBRL(a.priceCents)})`)),
            item.notes ? el('div', { class: 'admin-list__meta' }, `Obs.: ${item.notes}`) : null,
            el('div', {}, formatBRL(item.lineTotalCents))))),
        el('p', {}, `Pagamento: ${PAYMENT_LABEL[order.paymentMethod] ?? order.paymentMethod}`),
        order.changeForCents != null ? el('p', {}, `Troco para ${formatBRL(order.changeForCents)}`) : null,
        order.notes ? el('p', {}, `Observações: ${order.notes}`) : null,
        el('p', {}, el('strong', {}, `Total: ${formatBRL(order.subtotalCents)}`)),
        el('div', { class: 'confirm-dialog__actions' }, actions, closeBtn));
    }
    paintDetail();
  }

  // Sem polling: atualiza ao voltar para a aba do navegador, enquanto a tela estiver montada.
  const onVisible = () => {
    if (!container.isConnected) { document.removeEventListener('visibilitychange', onVisible); return; }
    if (document.visibilityState === 'visible') load(true);
  };
  document.addEventListener('visibilitychange', onVisible);

  await load(true);
}
