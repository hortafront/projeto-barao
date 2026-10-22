// Janela "Montar combo": uma etapa (fieldset) por vaga do combo do dia.
// Vaga de pizza = sabor(es) restritos à vaga + adicionais (mesma montagem do modal da pizza);
// vaga de bebida = rádio. Preço ao vivo = /shared/pricing.js (o servidor recalcula tudo).
import { calcItemCents } from '/shared/pricing.js';
import { formatBRL } from '/shared/money.js';
import { el, openDialog, render } from './dom.js';
import { addonSections, choice, readSelection } from './product-modal.js';

const MAX_QTY = 20;
const MAX_NOTES = 140;

const nameOf = (productsById, id) => productsById.get(id)?.name ?? 'Item indisponível';

/** Mesma descrição que o servidor grava: "Pizza X" ou "Pizza meio a meio: A / B". */
export function describePizza(flavorIds, productsById) {
  return flavorIds.length === 2
    ? `Pizza meio a meio: ${flavorIds.map((id) => nameOf(productsById, id)).join(' / ')}`
    : `Pizza ${nameOf(productsById, flavorIds[0])}`;
}

/** Uma descrição por vaga: pizza ou nome da bebida. */
export function describeComboSlots(_combo, slots, productsById) {
  return slots.map((slot) => (slot.kind === 'drink'
    ? nameOf(productsById, slot.productId)
    : describePizza(slot.flavorIds, productsById)));
}

function slotComplete(slot, choiceSlot) {
  if (!slot || slot.kind !== choiceSlot.kind) return false;
  if (slot.kind === 'drink') return choiceSlot.productIds.includes(slot.productId);
  const ids = slot.flavorIds;
  return Array.isArray(ids) && ids.length >= 1 && ids.length <= 2 && new Set(ids).size === ids.length
    && ids.every((id) => choiceSlot.productIds.includes(id));
}

/** True só quando TODAS as vagas têm uma escolha permitida (null/ausente = vaga em aberto). */
export function comboSelectionComplete(combo, slots) {
  return Array.isArray(slots) && slots.length === combo.slots.length
    && combo.slots.every((choiceSlot, i) => slotComplete(slots[i], choiceSlot));
}

/** Total em centavos: (preço do combo + adicionais de todas as pizzas) × quantidade. */
export function comboSelectionCents(combo, slots, productsById, quantity = 1) {
  const addons = (slots ?? []).flatMap((s) => (s?.kind === 'pizza' ? (s.addonIds ?? []) : []))
    .map((id) => productsById.get(id)).filter(Boolean);
  return calcItemCents({ kind: 'combo', combo, addons, quantity });
}

// ---------- DOM ----------

const slotPrefix = (i) => `s${i}:`;

/** Sub-FormData da vaga i, sem o prefixo, para reaproveitar readSelection. */
function slotData(formData, i) {
  const prefix = slotPrefix(i);
  const sub = new FormData();
  for (const [key, value] of formData.entries()) {
    if (key.startsWith(prefix)) sub.append(key.slice(prefix.length), value);
  }
  return sub;
}

/** Lê o formulário: { slots (parciais), incomplete } — meio a meio sem 2º sabor conta como incompleto. */
function readSlots(formData, combo) {
  let incomplete = false;
  const slots = combo.slots.map((slot, i) => {
    const sub = slotData(formData, i);
    if (slot.kind === 'drink') {
      const productId = String(sub.get('drink') ?? '');
      return productId ? { kind: 'drink', productId } : null;
    }
    const first = String(sub.get('first') ?? '');
    if (!first) return null;
    const { flavorIds, addonIds, incomplete: halfIncomplete } = readSelection(sub, first);
    if (halfIncomplete) incomplete = true;
    return { kind: 'pizza', flavorIds, addonIds };
  });
  return { slots, incomplete };
}

/**
 * Abre a janela. onAdd(item) recebe { kind:'combo', comboId, slots, quantity, notes }.
 */
export function openComboModal(dialog, combo, { productsById, menu, onAdd } = {}) {
  const lookup = productsById ?? new Map();
  const addons = (menu?.categories ?? []).flatMap((c) => c.products ?? []).filter((p) => p.kind === 'addon' && p.available);
  const allowed = (slot, kind) => slot.productIds.map((id) => lookup.get(id)).filter((p) => p?.kind === kind);
  let close = () => {};

  const title = el('h2', { class: 'pizza-modal__title', id: 'combo-modal-title', tabindex: '-1' }, combo.name);
  const qtyInput = el('input', { type: 'hidden', name: 'quantity', value: '1' });
  const qtyOut = el('output', { class: 'qty__value', 'aria-live': 'polite' }, '1');
  const livePrice = el('span', { class: 'pizza-modal__total', 'aria-live': 'polite' });
  const hint = el('p', { class: 'pizza-modal__hint', hidden: true }, 'Escolha uma opção em cada etapa para continuar.');
  const submit = el('button', { type: 'submit', class: 'btn btn--primary pizza-modal__submit' }, 'Adicionar — ', livePrice);
  const secondSets = new Map(); // índice da vaga -> fieldset do 2º sabor

  const flavorChoice = (i, name, p) => choice({
    type: 'radio', name, value: p.id, disabled: p.available === false,
    label: p.available === false ? `${p.name} (esgotado)` : p.name,
  });

  function pizzaStep(slot, i) {
    const flavors = allowed(slot, 'pizza');
    const prefix = slotPrefix(i);
    const second = el('fieldset', { class: 'pizza-modal__section combo-step__second', hidden: true },
      el('legend', {}, 'Segundo sabor'),
      el('p', { class: 'pizza-modal__note' }, 'O sabor não muda o preço do combo.'),
      flavors.map((p) => flavorChoice(i, `${prefix}second`, p)));
    secondSets.set(i, second);
    return el('fieldset', { class: 'pizza-modal__section combo-step', dataset: { slot: String(i) } },
      el('legend', {}, slot.label),
      el('div', { class: 'combo-step__body' },
        el('p', { class: 'pizza-modal__label' }, 'Sabor'),
        flavors.map((p) => flavorChoice(i, `${prefix}first`, p)),
        flavors.length > 1 && el('div', { class: 'segment' },
          el('label', { class: 'segment__opt' }, el('input', { type: 'radio', name: `${prefix}mode`, value: 'whole', checked: true }), el('span', {}, 'Inteira')),
          el('label', { class: 'segment__opt' }, el('input', { type: 'radio', name: `${prefix}mode`, value: 'half' }), el('span', {}, 'Meio a meio'))),
        second,
        addonSections(addons, prefix)));
  }

  function drinkStep(slot, i) {
    return el('fieldset', { class: 'pizza-modal__section combo-step', dataset: { slot: String(i) } },
      el('legend', {}, slot.label),
      allowed(slot, 'drink').map((p) => choice({
        type: 'radio', name: `${slotPrefix(i)}drink`, value: p.id, disabled: p.available === false,
        label: p.available === false ? `${p.name} (esgotado)` : p.name,
      })));
  }

  const stepButton = (label, text, delta) => el('button', {
    type: 'button', class: 'btn-icon qty__btn', 'aria-label': label,
    onclick: () => {
      const next = Math.min(MAX_QTY, Math.max(1, (Number.parseInt(qtyInput.value, 10) || 1) + delta));
      qtyInput.value = String(next);
      update();
    },
  }, text);

  const form = el('form', { class: 'pizza-modal combo-modal', novalidate: true },
    el('div', { class: 'pizza-modal__scroll' },
      el('header', { class: 'pizza-modal__head' },
        el('div', {},
          el('p', { class: 'combo-modal__tag' }, 'Promoção do dia'),
          title,
          combo.description && el('p', { class: 'pizza-modal__desc' }, combo.description),
          el('p', { class: 'combo-modal__base' }, `Combo por ${formatBRL(combo.priceCents)}`)),
        el('button', { type: 'button', class: 'btn-icon pizza-modal__close', 'aria-label': 'Fechar', onclick: () => close() }, '×')),
      combo.slots.map((slot, i) => (slot.kind === 'drink' ? drinkStep(slot, i) : pizzaStep(slot, i))),
      el('div', { class: 'pizza-modal__section' },
        el('label', { for: 'combo-notes', class: 'pizza-modal__label' }, 'Observação'),
        el('textarea', { id: 'combo-notes', name: 'notes', maxlength: String(MAX_NOTES), rows: '2', placeholder: 'Ex.: sem cebola' })),
      el('div', { class: 'pizza-modal__section qty' },
        el('span', { class: 'pizza-modal__label', id: 'combo-qty-label' }, 'Quantidade'),
        el('div', { class: 'qty__stepper', role: 'group', 'aria-labelledby': 'combo-qty-label' },
          stepButton('Diminuir quantidade', '−', -1), qtyOut, stepButton('Aumentar quantidade', '+', 1)),
        qtyInput)),
    el('footer', { class: 'pizza-modal__foot' }, hint, submit));

  function quantity() {
    return Math.min(MAX_QTY, Math.max(1, Number.parseInt(qtyInput.value, 10) || 1));
  }

  function syncSecondFlavor(formData) {
    for (const [i, fieldset] of secondSets) {
      const sub = slotData(formData, i);
      const half = sub.get('mode') === 'half';
      const first = String(sub.get('first') ?? '');
      fieldset.hidden = !half;
      for (const radio of fieldset.querySelectorAll('input[type="radio"]')) {
        const sameAsFirst = radio.value === first;
        const soldOut = lookup.get(radio.value)?.available === false;
        radio.disabled = sameAsFirst || soldOut;
        if (sameAsFirst && radio.checked) radio.checked = false;
      }
    }
  }

  function update() {
    syncSecondFlavor(new FormData(form));
    const { slots, incomplete } = readSlots(new FormData(form), combo);
    const qty = quantity();
    qtyOut.textContent = String(qty);
    const ready = !incomplete && comboSelectionComplete(combo, slots);
    submit.disabled = !ready;
    hint.hidden = ready;
    livePrice.textContent = formatBRL(comboSelectionCents(combo, slots, lookup, qty));
  }

  form.addEventListener('change', update);
  form.addEventListener('input', update);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const { slots, incomplete } = readSlots(data, combo);
    if (incomplete || !comboSelectionComplete(combo, slots)) return;
    const notes = String(data.get('notes') ?? '').trim().slice(0, MAX_NOTES);
    close();
    onAdd?.({ kind: 'combo', comboId: combo.id, slots, quantity: quantity(), notes });
  });

  dialog.classList.add('modal--pizza', 'modal--combo');
  dialog.setAttribute('aria-labelledby', 'combo-modal-title');
  render(dialog, form);
  update();
  close = openDialog(dialog, { initialFocus: title });
}
