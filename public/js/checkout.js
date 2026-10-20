// Carrinho (drawer), checkout e confirmação. Sem regra de negócio: o servidor valida e recalcula tudo.
import { createOrder } from './api.js';
import { $, el, openDialog, render } from './dom.js';
import { lineId } from './cart.js';
import {
  FieldError, buildOrderPayload, createOrderSubmitter, fieldErrorsFromDetails, maskPhone,
} from './order-payload.js';
import { formatBRL } from '/shared/money.js';

const PIX_NOTICE = 'A chave Pix será enviada pelo WhatsApp após o pedido';
const DELIVERY_NOTICE = 'Taxa de entrega a combinar pelo WhatsApp';
const EMPTY_TEXT = 'Seu carrinho está vazio. Bateu a fome? Escolha uma pizza.';
const CLOSED_TEXT = 'Loja fechada no momento. Você pode montar o pedido, mas só consegue finalizar quando abrirmos.';
const BLOCKED_TEXT = 'Alguns itens ficaram indisponíveis. Remova-os do carrinho para continuar.';
const FIELD_ORDER = ['name', 'phone', 'fulfillment', 'street', 'number', 'district', 'reference', 'payment', 'changeFor', 'notes'];

export function initCheckout({ cart, getProductsById, getStatus, reloadMenu, onStoreClosed } = {}) {
  const bar = $('#cart-bar');
  const barCount = $('#cart-count');
  const barTotal = $('#cart-total');
  const drawer = $('#cart-drawer');
  const checkoutDialog = $('#checkout-modal');

  let closed = false; // última resposta de /api/status (o servidor ainda decide no POST)
  let drawerNotice = '';
  let closeDrawerFn = null;
  let closeCheckoutFn = null;
  let afterDrawerClose = null;
  let focusKey = null;
  let submitting = false;

  const products = () => getProductsById();
  const subtotal = () => cart.subtotalCents(products());
  const unavailableIds = () => {
    const map = products();
    return new Set(cart.getItems().filter((line) => {
      const ids = line.kind === 'drink' ? [line.productId] : [...line.flavorIds, ...line.addonIds];
      return ids.some((id) => map.get(id)?.available === false);
    }).map(lineId));
  };

  async function fetchStatus() {
    const res = await getStatus();
    if (res.ok) closed = res.data?.open === false;
    return closed;
  }

  // ---------- barra fixa ----------
  function paintBar() {
    const n = cart.count();
    bar.hidden = n === 0;
    barCount.textContent = n === 1 ? '1 item' : `${n} itens`;
    barTotal.textContent = formatBRL(subtotal());
  }

  // ---------- drawer ----------
  function lineView(line, unavailable) {
    const map = products();
    const id = lineId(line);
    const addons = line.kind === 'pizza' ? line.addonIds.map((a) => map.get(a)?.name).filter(Boolean) : [];
    return el('li', { class: `cart-line${unavailable.has(id) ? ' is-unavailable' : ''}` },
      el('div', { class: 'cart-line__main' },
        el('p', { class: 'cart-line__name' }, cart.describe(line, map)),
        ...addons.map((name) => el('p', { class: 'cart-line__extra' }, `+ ${name}`)),
        line.notes && el('p', { class: 'cart-line__extra' }, `Obs.: ${line.notes}`),
        unavailable.has(id) && el('p', { class: 'cart-line__alert' }, 'Indisponível no momento')),
      el('div', { class: 'cart-line__controls' },
        el('div', { class: 'stepper' },
          el('button', {
            type: 'button', class: 'stepper__btn', 'aria-label': 'Diminuir quantidade', 'data-focus': `dec:${id}`,
            onclick: () => { focusKey = `dec:${id}`; cart.setQuantity(id, line.quantity - 1); },
          }, '−'),
          el('span', { class: 'stepper__value', 'aria-label': `Quantidade: ${line.quantity}` }, String(line.quantity)),
          el('button', {
            type: 'button', class: 'stepper__btn', 'aria-label': 'Aumentar quantidade', 'data-focus': `inc:${id}`,
            disabled: line.quantity >= 20,
            onclick: () => { focusKey = `inc:${id}`; cart.setQuantity(id, line.quantity + 1); },
          }, '+')),
        el('button', {
          type: 'button', class: 'link-btn', onclick: () => { focusKey = 'close'; cart.remove(id); },
        }, 'Remover'),
        el('span', { class: 'price' }, formatBRL(cart.lineTotalCents(line, products())))));
  }

  function paintDrawer() {
    if (!drawer.open) return;
    const items = cart.getItems();
    const blocked = cart.isBlocked(products());
    const unavailable = unavailableIds();
    const header = el('header', { class: 'sheet__head' },
      el('h2', { id: 'cart-title', class: 'sheet__title' }, 'Seu carrinho'),
      el('button', { type: 'button', class: 'sheet__close', 'aria-label': 'Fechar carrinho', 'data-focus': 'close', onclick: () => closeDrawerFn?.() }, '×'));

    if (items.length === 0) {
      render(drawer, el('div', { class: 'sheet' }, header,
        el('div', { class: 'sheet__body cart-empty' },
          el('p', { class: 'cart-empty__text' }, EMPTY_TEXT),
          el('button', { type: 'button', class: 'btn btn--primary', onclick: () => closeDrawerFn?.() }, 'Ver cardápio'))));
    } else {
      const canFinish = !closed && !blocked;
      render(drawer, el('div', { class: 'sheet' }, header,
        el('div', { class: 'sheet__body' },
          drawerNotice && el('p', { class: 'notice notice--warn', role: 'alert' }, drawerNotice),
          blocked && el('p', { class: 'notice notice--warn' }, BLOCKED_TEXT),
          closed && el('p', { class: 'notice notice--warn' }, CLOSED_TEXT),
          el('ul', { class: 'cart-lines' }, items.map((line) => lineView(line, unavailable)))),
        el('footer', { class: 'sheet__foot' },
          el('div', { class: 'total-row' },
            el('span', {}, 'Subtotal'),
            el('span', { class: 'price' }, formatBRL(subtotal()))),
          el('button', {
            type: 'button', class: 'btn btn--primary btn--block', disabled: !canFinish,
            onclick: () => { afterDrawerClose = openCheckout; closeDrawerFn?.(); },
          }, 'Finalizar pedido'))));
    }
    if (focusKey) {
      const target = [...drawer.querySelectorAll('[data-focus]')].find((n) => n.dataset.focus === focusKey)
        ?? drawer.querySelector('[data-focus="close"]');
      target?.focus();
      focusKey = null;
    }
  }

  function openDrawer() {
    if (drawer.open || checkoutDialog.open) return;
    drawer.replaceChildren();
    closeDrawerFn = openDialog(drawer, {
      onClose: () => {
        closeDrawerFn = null;
        const next = afterDrawerClose;
        afterDrawerClose = null;
        next?.();
      },
    });
    paintDrawer();
    fetchStatus().then(paintDrawer);
  }

  // ---------- checkout ----------
  function openCheckout() {
    if (checkoutDialog.open || cart.count() === 0) return;
    drawerNotice = '';
    paintCheckout();
    closeCheckoutFn = openDialog(checkoutDialog, {
      onClose: () => { closeCheckoutFn = null; },
      initialFocus: checkoutDialog.querySelector('input'),
    });
    fetchStatus();
  }

  const fieldRefs = new Map(); // name -> { control(s), error element }

  function field(name, label, control, { hint } = {}) {
    const error = el('p', { class: 'field-error', id: `err-${name}`, hidden: true });
    fieldRefs.set(name, { error, group: null });
    return el('div', { class: 'field', 'data-field': name },
      label && el('label', { for: `f-${name}` }, label),
      control,
      hint && el('p', { class: 'field__hint' }, hint),
      error);
  }

  function radioGroup(name, legend, options, checked) {
    const error = el('p', { class: 'field-error', id: `err-${name}`, hidden: true });
    const fieldset = el('fieldset', { class: 'field field--radios', 'data-field': name },
      el('legend', {}, legend),
      el('div', { class: 'radio-row' }, options.map(([value, text]) => el('label', { class: 'radio' },
        el('input', { type: 'radio', name, value, checked: value === checked, required: true }),
        el('span', {}, text)))),
      error);
    fieldRefs.set(name, { error, group: fieldset });
    return fieldset;
  }

  function showErrors(errors) {
    for (const [name, ref] of fieldRefs) {
      ref.error.hidden = true;
      ref.error.textContent = '';
      for (const c of controlsOf(name)) { c.removeAttribute('aria-invalid'); c.removeAttribute('aria-describedby'); }
    }
    const names = FIELD_ORDER.filter((n) => errors[n]);
    for (const name of names) {
      const ref = fieldRefs.get(name);
      if (!ref) continue;
      ref.error.textContent = errors[name];
      ref.error.hidden = false;
      for (const c of controlsOf(name)) { c.setAttribute('aria-invalid', 'true'); c.setAttribute('aria-describedby', `err-${name}`); }
    }
    const first = names.map((n) => controlsOf(n)[0]).find(Boolean);
    first?.focus();
    return names.length > 0;
  }

  const controlsOf = (name) => {
    const ref = fieldRefs.get(name);
    if (ref?.group) return [ref.group.querySelector('input')].filter(Boolean);
    const node = checkoutDialog.querySelector(`#f-${name}`);
    return node ? [node] : [];
  };

  function paintCheckout() {
    fieldRefs.clear();
    const total = subtotal();
    const formError = el('p', { class: 'notice notice--error', role: 'alert', hidden: true });
    const pixNote = el('p', { class: 'notice', hidden: true }, PIX_NOTICE);
    const deliveryNote = el('p', { class: 'notice', hidden: true }, DELIVERY_NOTICE);
    const addressBox = el('div', { class: 'address-box', hidden: true },
      field('street', 'Rua', el('input', { id: 'f-street', name: 'street', type: 'text', maxlength: 120, autocomplete: 'address-line1' })),
      el('div', { class: 'field-row' },
        field('number', 'Número', el('input', { id: 'f-number', name: 'number', type: 'text', maxlength: 10, autocomplete: 'off' })),
        field('district', 'Bairro', el('input', { id: 'f-district', name: 'district', type: 'text', maxlength: 60, autocomplete: 'address-level3' }))),
      field('reference', 'Referência (opcional)', el('input', { id: 'f-reference', name: 'reference', type: 'text', maxlength: 120, autocomplete: 'off' })));
    const changeBox = el('div', { class: 'change-box', hidden: true },
      field('changeFor', 'Troco para (opcional)', el('input', { id: 'f-changeFor', name: 'changeFor', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: 'Ex.: 100' })));

    const submitBtn = el('button', { type: 'submit', class: 'btn btn--primary btn--block' }, 'Enviar pedido pelo WhatsApp');

    const form = el('form', { class: 'checkout-form', novalidate: true },
      field('name', 'Nome', el('input', { id: 'f-name', name: 'name', type: 'text', required: true, minlength: 2, maxlength: 60, autocomplete: 'name' })),
      field('phone', 'Telefone (WhatsApp)', el('input', { id: 'f-phone', name: 'phone', type: 'tel', inputmode: 'numeric', required: true, autocomplete: 'tel-national', placeholder: '(85) 99999-9999' })),
      radioGroup('fulfillment', 'Como prefere receber?', [['delivery', 'Entrega'], ['pickup', 'Retirada']], 'delivery'),
      addressBox,
      deliveryNote,
      radioGroup('payment', 'Pagamento', [['pix', 'Pix'], ['cash', 'Dinheiro'], ['card', 'Cartão (maquininha)']], 'pix'),
      pixNote,
      changeBox,
      field('notes', 'Observações (opcional)', el('textarea', { id: 'f-notes', name: 'notes', maxlength: 280, rows: 3 })),
      formError,
      el('div', { class: 'total-row' }, el('span', {}, 'Total dos itens'), el('span', { class: 'price' }, formatBRL(total))),
      submitBtn);

    const sync = () => {
      const data = new FormData(form);
      const delivery = data.get('fulfillment') === 'delivery';
      const method = data.get('payment');
      addressBox.hidden = !delivery;
      deliveryNote.hidden = !delivery;
      pixNote.hidden = method !== 'pix';
      changeBox.hidden = method !== 'cash';
    };
    form.addEventListener('change', sync);
    form.elements.phone.addEventListener('input', (e) => { e.target.value = maskPhone(e.target.value); });
    sync();

    const submitter = createOrderSubmitter({
      createOrder,
      onSuccess: (data) => onCreated(data, new FormData(form)),
      onError: (error) => onFailed(error, { formError }),
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (submitter.pending) return;
      formError.hidden = true;
      const fields = Object.fromEntries(new FormData(form).entries());
      let payload;
      try {
        payload = buildOrderPayload(fields, cart.toOrderItems(), subtotal());
      } catch (err) {
        if (!(err instanceof FieldError)) throw err;
        showErrors({ [err.field]: err.message });
        return;
      }
      showErrors({});
      submitting = true;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Enviando…';
      await submitter.submit(payload);
      submitting = false;
      if (submitBtn.isConnected) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Enviar pedido pelo WhatsApp';
      }
    });

    render(checkoutDialog, el('div', { class: 'sheet' },
      el('header', { class: 'sheet__head' },
        el('h2', { id: 'checkout-title', class: 'sheet__title' }, 'Finalizar pedido'),
        el('button', {
          type: 'button', class: 'sheet__close', 'aria-label': 'Voltar ao carrinho',
          onclick: () => { if (!submitting) backToDrawer(); },
        }, '×')),
      el('div', { class: 'sheet__body' }, form)));
  }

  function backToDrawer(notice = '') {
    drawerNotice = notice;
    if (checkoutDialog.open) {
      closeCheckoutFn = null;
      checkoutDialog.addEventListener('close', () => openDrawer(), { once: true });
      checkoutDialog.close();
    } else {
      openDrawer();
    }
  }

  function onCreated(data, formData) {
    const method = formData.get('payment');
    const delivery = formData.get('fulfillment') === 'delivery';
    cart.clear(); // dispara refresh via subscribe
    const link = el('a', { class: 'btn btn--primary btn--block', href: data.whatsappUrl, rel: 'noopener' }, 'Abrir WhatsApp');
    render(checkoutDialog, el('div', { class: 'sheet sheet--confirm' },
      el('div', { class: 'sheet__body confirm' },
        el('p', { class: 'confirm__script' }, 'Pedido recebido!'),
        el('h2', { id: 'checkout-title', class: 'confirm__title' }, `Pedido ${data.code} registrado!`),
        el('p', { class: 'confirm__code price' }, data.code),
        el('p', { class: 'total-row' }, el('span', {}, 'Total dos itens'), el('span', { class: 'price' }, formatBRL(data.subtotalCents))),
        el('p', {}, 'Toque no botão para enviar o pedido pelo WhatsApp. O pedido só é confirmado pela loja no WhatsApp.'),
        delivery && el('p', { class: 'notice' }, DELIVERY_NOTICE),
        method === 'pix' && el('p', { class: 'notice' }, PIX_NOTICE),
        link,
        el('button', { type: 'button', class: 'btn btn--block', onclick: () => closeCheckoutFn?.() }, 'Fazer novo pedido'))));
    link.focus();
    window.location.href = data.whatsappUrl; // mesma aba; o link acima é o fallback
  }

  async function onFailed(error, { formError }) {
    const say = (text) => { formError.textContent = text; formError.hidden = false; formError.scrollIntoView?.({ block: 'nearest' }); };
    if (error.code === 'VALIDATION_ERROR') {
      const errors = fieldErrorsFromDetails(error.details);
      const shown = showErrors(errors);
      if (!shown || errors.items) say(error.message);
      return;
    }
    if (error.code === 'STORE_CLOSED') {
      closed = true;
      say(error.message);
      onStoreClosed?.();
      return;
    }
    if (error.code === 'PRODUCT_UNAVAILABLE') {
      await reloadMenu?.();
      backToDrawer(error.message || BLOCKED_TEXT);
      return;
    }
    if (error.code === 'RATE_LIMITED') {
      say('Muitas tentativas, aguarde alguns minutos e tente de novo. Seu carrinho foi mantido.');
      return;
    }
    if (error.code === 'NETWORK') {
      say('Sem conexão. Seu carrinho foi mantido.');
      return;
    }
    say(error.message || 'Algo deu errado. Seu carrinho foi mantido. Tente novamente.');
  }

  // Esc não fecha o checkout durante o envio.
  checkoutDialog.addEventListener('cancel', (event) => { if (submitting) event.preventDefault(); });

  $('#cart-open').addEventListener('click', openDrawer);
  cart.subscribe(() => { paintBar(); paintDrawer(); });
  paintBar();

  return {
    refresh() {
      paintBar();
      paintDrawer();
    },
  };
}
