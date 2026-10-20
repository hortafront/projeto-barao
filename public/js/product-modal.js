// Modal da pizza: inteira ou meio a meio, no máximo uma borda (radio), adicionais livres (checkbox),
// observação, quantidade e preço ao vivo. Preço = /shared/pricing.js (mesmo código do servidor).
import { calcItemCents } from '/shared/pricing.js';
import { formatBRL } from '/shared/money.js';
import { el, openDialog, render } from './dom.js';

const MAX_QTY = 20;
const MAX_NOTES = 140;
const GROUP_PREFIX = 'addon-group:';
const GROUP_LABELS = { borda: 'Borda' };

const allProducts = (menu) => (menu?.categories ?? []).flatMap((c) => c.products ?? []);

/** Pizzas disponíveis para o 2º sabor (exclui o 1º). */
export function secondFlavorOptions(menu, firstId) {
  return allProducts(menu).filter((p) => p.kind === 'pizza' && p.available && p.id !== firstId);
}

/** Addons com addonGroup viram grupos (radio, no máx. 1); sem grupo ficam livres (checkbox). */
export function splitAddons(addons) {
  const groups = new Map();
  const free = [];
  for (const addon of addons) {
    if (addon.addonGroup) {
      if (!groups.has(addon.addonGroup)) groups.set(addon.addonGroup, []);
      groups.get(addon.addonGroup).push(addon);
    } else free.push(addon);
  }
  return { groups, free };
}

/** Lê o FormData do modal. `incomplete` = meio a meio sem 2º sabor. */
export function readSelection(formData, firstFlavorId) {
  const half = formData.get('mode') === 'half';
  const second = String(formData.get('second') ?? '');
  const groupPicks = [...new Set([...formData.keys()].filter((k) => k.startsWith(GROUP_PREFIX)))]
    .map((k) => String(formData.get(k) ?? ''))
    .filter(Boolean); // "" = "Sem borda"
  const qty = Number.parseInt(String(formData.get('quantity') ?? ''), 10);
  return {
    kind: 'pizza',
    flavorIds: half && second ? [firstFlavorId, second] : [firstFlavorId],
    addonIds: [...groupPicks, ...formData.getAll('addon').map(String)],
    quantity: Number.isInteger(qty) ? Math.min(MAX_QTY, Math.max(1, qty)) : 1,
    notes: String(formData.get('notes') ?? '').trim().slice(0, MAX_NOTES),
    incomplete: half && !second,
  };
}

/** Total da linha em centavos, a partir dos produtos do /api/menu. */
export function selectionCents(selection, productsById) {
  const pick = (ids) => ids.map((id) => productsById.get(id)).filter(Boolean);
  return calcItemCents({
    kind: 'pizza',
    flavors: pick(selection.flavorIds),
    addons: pick(selection.addonIds),
    quantity: selection.quantity,
  });
}

// ---------- DOM ----------

function choice({ type, name, value, checked = false, label, priceCents, plus = false, id }) {
  return el('label', { class: 'choice' },
    el('input', { type, name, value, checked, id }),
    el('span', { class: 'choice__label' }, label),
    priceCents != null && el('span', { class: 'price choice__price' }, `${plus ? '+' : ''}${formatBRL(priceCents)}`));
}

function addonSections(addons) {
  const { groups, free } = splitAddons(addons);
  const sections = [];
  for (const [group, items] of groups) {
    const title = GROUP_LABELS[group] ?? group;
    sections.push(el('fieldset', { class: 'pizza-modal__section' },
      el('legend', {}, title),
      choice({ type: 'radio', name: `${GROUP_PREFIX}${group}`, value: '', checked: true, label: `Sem ${title.toLowerCase()}` }),
      items.map((a) => choice({
        type: 'radio', name: `${GROUP_PREFIX}${group}`, value: a.id, label: a.name, priceCents: a.priceCents, plus: true,
      }))));
  }
  if (free.length > 0) {
    sections.push(el('fieldset', { class: 'pizza-modal__section' },
      el('legend', {}, 'Adicionais'),
      free.map((a) => choice({ type: 'checkbox', name: 'addon', value: a.id, label: a.name, priceCents: a.priceCents, plus: true }))));
  }
  return sections;
}

/**
 * Abre o modal. onAdd(item) recebe { kind:'pizza', flavorIds, addonIds, quantity, notes }.
 */
export function openPizzaModal(dialog, product, { menu, productsById, onAdd } = {}) {
  const addons = allProducts(menu).filter((p) => p.kind === 'addon' && p.available);
  const seconds = secondFlavorOptions(menu, product.id);
  const lookup = productsById ?? new Map(allProducts(menu).map((p) => [p.id, p]));
  let close = () => {};

  const title = el('h2', { class: 'pizza-modal__title', id: 'product-modal-title', tabindex: '-1' }, product.name);
  const qtyInput = el('input', { type: 'hidden', name: 'quantity', value: '1' });
  const qtyOut = el('output', { class: 'qty__value', 'aria-live': 'polite' }, '1');
  const livePrice = el('span', { class: 'pizza-modal__total', 'aria-live': 'polite' });
  const hint = el('p', { class: 'pizza-modal__hint', hidden: true }, 'Escolha o 2º sabor para continuar.');
  const submit = el('button', { type: 'submit', class: 'btn btn--primary pizza-modal__submit' }, 'Adicionar — ', livePrice);

  const secondFieldset = el('fieldset', { class: 'pizza-modal__section', id: 'pizza-second', hidden: true },
    el('legend', {}, 'Segundo sabor'),
    el('p', { class: 'pizza-modal__note' }, 'Na meio a meio vale o preço do sabor mais caro.'),
    seconds.map((p) => choice({ type: 'radio', name: 'second', value: p.id, label: p.name, priceCents: p.priceCents })));

  const stepButton = (label, text, delta) => el('button', {
    type: 'button', class: 'btn-icon qty__btn', 'aria-label': label,
    onclick: () => {
      const next = Math.min(MAX_QTY, Math.max(1, (Number.parseInt(qtyInput.value, 10) || 1) + delta));
      qtyInput.value = String(next);
      update();
    },
  }, text);

  const form = el('form', { class: 'pizza-modal', novalidate: true },
    el('div', { class: 'pizza-modal__scroll' },
      el('header', { class: 'pizza-modal__head' },
        el('div', {}, title, product.description && el('p', { class: 'pizza-modal__desc' }, product.description)),
        el('button', { type: 'button', class: 'btn-icon pizza-modal__close', 'aria-label': 'Fechar', onclick: () => close() }, '×')),
      el('fieldset', { class: 'pizza-modal__section pizza-modal__mode' },
        el('legend', {}, 'Como você quer?'),
        el('div', { class: 'segment' },
          el('label', { class: 'segment__opt' }, el('input', { type: 'radio', name: 'mode', value: 'whole', checked: true }), el('span', {}, 'Inteira')),
          seconds.length > 0 && el('label', { class: 'segment__opt' }, el('input', { type: 'radio', name: 'mode', value: 'half' }), el('span', {}, 'Meio a meio')))),
      secondFieldset,
      addonSections(addons),
      el('div', { class: 'pizza-modal__section' },
        el('label', { for: 'pizza-notes', class: 'pizza-modal__label' }, 'Observação'),
        el('textarea', { id: 'pizza-notes', name: 'notes', maxlength: String(MAX_NOTES), rows: '2', placeholder: 'Ex.: sem cebola' })),
      el('div', { class: 'pizza-modal__section qty' },
        el('span', { class: 'pizza-modal__label', id: 'pizza-qty-label' }, 'Quantidade'),
        el('div', { class: 'qty__stepper', role: 'group', 'aria-labelledby': 'pizza-qty-label' },
          stepButton('Diminuir quantidade', '−', -1), qtyOut, stepButton('Aumentar quantidade', '+', 1)),
        qtyInput)),
    el('footer', { class: 'pizza-modal__foot' }, hint, submit));

  function update() {
    const { incomplete, ...line } = readSelection(new FormData(form), product.id);
    secondFieldset.hidden = new FormData(form).get('mode') !== 'half';
    qtyOut.textContent = String(line.quantity);
    submit.disabled = incomplete;
    hint.hidden = !incomplete;
    livePrice.textContent = formatBRL(selectionCents(line, lookup));
  }

  form.addEventListener('change', update);
  form.addEventListener('input', update);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const { incomplete, ...item } = readSelection(new FormData(form), product.id);
    if (incomplete) return;
    close();
    onAdd?.(item);
  });

  dialog.classList.add('modal--pizza');
  dialog.setAttribute('aria-labelledby', 'product-modal-title');
  render(dialog, form);
  update();
  close = openDialog(dialog, { initialFocus: title });
}
