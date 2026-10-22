// Tela Combos do painel: faixa "hoje", lista, criar/editar (dias, vagas, produtos permitidos), Esgotado, foto, excluir.
import { el, render } from '../../js/dom.js';
import { parseBRLToCents, formatBRL } from '/shared/money.js';
import { withSaving } from './admin-api.js';

const TIME_ZONE = 'America/Fortaleza';
const MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PRICE_ERROR = 'Preço inválido. Ex.: 36,90';
const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MAX_SLOTS = 4;
const SHORTCUTS = [
  { label: 'Marcar todas as Clássicas', kind: 'pizza', slug: 'classicas' },
  { label: 'Marcar todas as Especiais', kind: 'pizza', slug: 'especiais' },
  { label: 'Marcar todas as Bebidas', kind: 'drink', slug: 'bebidas' },
];

// ---------------------------------------------------------------- puras
/** [2,4] -> 'Ter · Qui' */
export function formatWeekdays(weekdays) {
  return [...weekdays].sort((a, b) => a - b).map((d) => WEEKDAY_SHORT[d]).join(' · ');
}

/** Dia (0-6) -> nome do OUTRO combo que já ocupa o dia. */
export function takenWeekdays(combos, editingId) {
  const map = new Map();
  for (const combo of combos) {
    if (combo.id === editingId) continue;
    for (const day of combo.weekdays) map.set(day, combo.name);
  }
  return map;
}

/** Corpo de POST/PUT. Lança { field: 'price', message } se o preço for inválido. */
export function comboPayload(fields) {
  const priceCents = parseBRLToCents(fields.price);
  if (!Number.isInteger(priceCents) || priceCents <= 0) {
    throw Object.assign(new Error(PRICE_ERROR), { field: 'price', message: PRICE_ERROR });
  }
  return {
    name: String(fields.name ?? '').trim(),
    description: String(fields.description ?? '').trim(),
    priceCents,
    weekdays: [...fields.weekdays].sort((a, b) => a - b),
    slots: fields.slots.map((s) => ({ label: String(s.label ?? '').trim(), kind: s.kind, productIds: [...s.productIds] })),
  };
}

function weekdayInFortaleza(now) {
  const short = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, weekday: 'short' }).format(now);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(short);
}

/** Nome do combo que aparece hoje (dia em Fortaleza) ou null. */
export function todayComboName(combos, now = new Date()) {
  const today = weekdayInFortaleza(now);
  return combos.find((c) => c.weekdays.includes(today))?.name ?? null;
}

const CATEGORY_NAME = { classicas: 'Clássicas', especiais: 'Especiais', bebidas: 'Bebidas' };

// ---------------------------------------------------------------- tela
export async function mount(container, ctx) {
  const { adminApi, toast, confirmDialog } = ctx;
  let combos = [];
  let products = [];
  let previewUrl = null;

  const releasePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  };

  async function load() {
    render(container, el('p', { class: 'admin-note' }, 'Carregando combos…'));
    try {
      const [c, p] = await Promise.all([adminApi('/api/admin/combos'), adminApi('/api/admin/products')]);
      combos = c?.combos ?? [];
      products = p?.products ?? [];
      showList();
    } catch (err) {
      render(container,
        el('p', { class: 'form-notice', role: 'alert' }, err.message || 'Não foi possível carregar os combos.'),
        el('button', { type: 'button', class: 'btn', onclick: load }, 'Tentar de novo'));
    }
  }

  // ------------------------------------------------------------ lista
  function showList() {
    releasePreview();
    const today = todayComboName(combos);
    render(container,
      el('p', { class: 'form-notice', role: 'status' }, today ? `Hoje aparece: ${today}` : 'Nenhum combo hoje'),
      el('button', { type: 'button', class: 'btn btn--primary btn--block', onclick: () => showForm(null) }, 'Novo combo'),
      combos.length === 0 ? el('p', { class: 'admin-note' }, 'Nenhum combo cadastrado.') : null,
      el('div', { class: 'admin-list' }, combos.map(comboRow)));
  }

  function thumb(url) {
    return url
      ? el('img', { class: 'admin-thumb', src: url, alt: '', width: 56, height: 56, loading: 'lazy' })
      : el('span', { class: 'admin-thumb', 'aria-hidden': 'true' });
  }

  async function setAvailability(combo, next) {
    const res = await adminApi(`/api/admin/combos/${combo.id}/availability`, { method: 'PATCH', body: { available: next } });
    combo.available = next;
    return res;
  }

  function comboRow(combo) {
    const toggle = el('button', {
      type: 'button', class: 'switch', role: 'switch',
      'aria-checked': String(combo.available),
      'aria-label': `${combo.name}: ${combo.available ? 'disponível' : 'esgotado'}`,
      onclick: () => toggleAvailability(combo, toggle, status),
    });
    const status = el('span', { class: 'admin-list__meta' }, combo.available ? 'Disponível' : 'Esgotado');
    const remove = el('button', { type: 'button', class: 'btn btn--small btn--danger', onclick: () => removeCombo(combo, remove) }, 'Excluir');
    return el('div', { class: 'admin-list__row admin-list__row--combo' },
      thumb(combo.imageUrl),
      el('button', { type: 'button', class: 'admin-list__main admin-card--clickable', onclick: () => showForm(combo) },
        el('span', { class: 'admin-list__title' }, combo.name),
        el('span', { class: 'admin-list__meta' }, ` ${formatBRL(combo.priceCents)} · ${formatWeekdays(combo.weekdays)}`)),
      el('div', {}, toggle, status),
      remove);
  }

  async function toggleAvailability(combo, toggle, status) {
    const next = !combo.available;
    toggle.setAttribute('aria-checked', String(next));
    status.textContent = next ? 'Disponível' : 'Esgotado';
    toggle.disabled = true;
    try {
      await setAvailability(combo, next);
      toggle.setAttribute('aria-label', `${combo.name}: ${next ? 'disponível' : 'esgotado'}`);
      toast(next ? `${combo.name} disponível` : `${combo.name} marcado como esgotado`, 'success');
    } catch (err) {
      toggle.setAttribute('aria-checked', String(combo.available));
      status.textContent = combo.available ? 'Disponível' : 'Esgotado';
      toast(err.message, 'error');
    } finally {
      toggle.disabled = false;
    }
  }

  async function removeCombo(combo, button) {
    if (button.disabled) return;
    button.disabled = true; // trava durante confirmação + requisição
    try {
      const ok = await confirmDialog({
        title: `Excluir ${combo.name}?`,
        body: 'O combo some do cardápio. Isso não pode ser desfeito.',
        confirmLabel: 'Excluir', danger: true,
      });
      if (!ok) return;
      await withSaving(button, () => adminApi(`/api/admin/combos/${combo.id}`, { method: 'DELETE' }), { toast });
      combos = combos.filter((c) => c.id !== combo.id);
      showList();
    } catch {
      // withSaving já avisou (409 PRODUCT_HAS_ORDERS mostra a mensagem do servidor)
    } finally {
      button.disabled = false;
    }
  }

  // ------------------------------------------------------------ formulário
  function showForm(combo) {
    releasePreview();
    const isNew = !combo;
    const editingId = combo?.id ?? null;
    const taken = takenWeekdays(combos, editingId);

    // estado das vagas (fonte da verdade; o DOM das vagas é redesenhado nas mudanças estruturais)
    const slots = (combo?.slots ?? [{ label: 'Pizza', kind: 'pizza', productIds: [] }])
      .map((s) => ({ label: s.label, kind: s.kind, productIds: new Set(s.productIds) }));
    const days = new Set(combo?.weekdays ?? []);

    const errors = new Map(); // path -> <p>
    const errorSlot = (path) => {
      if (!errors.has(path)) errors.set(path, el('p', { class: 'field-error', role: 'alert' }));
      return errors.get(path);
    };
    const clearErrors = () => { for (const p of errors.values()) p.textContent = ''; generalError.textContent = ''; };

    const generalError = el('p', { class: 'field-error', role: 'alert' });
    const name = el('input', { id: 'c-name', type: 'text', maxlength: 60, required: true, value: combo?.name ?? '' });
    const description = el('textarea', { id: 'c-desc', maxlength: 200, rows: 2 });
    description.value = combo?.description ?? '';
    const price = el('input', {
      id: 'c-price', type: 'text', inputmode: 'decimal', autocomplete: 'off', required: true,
      value: combo ? formatBRL(combo.priceCents).replace(/^R\$\s?/, '') : '',
    });

    // dias
    const dayBoxes = WEEKDAY_SHORT.map((label, day) => {
      const blocked = taken.has(day);
      const box = el('input', { id: `c-day-${day}`, type: 'checkbox', checked: days.has(day) && !blocked, disabled: blocked });
      box.addEventListener('change', () => (box.checked ? days.add(day) : days.delete(day)));
      if (blocked) days.delete(day);
      return el('div', { class: 'weekday' },
        box,
        el('label', { for: `c-day-${day}` }, label),
        blocked ? el('span', { class: 'admin-list__meta' }, taken.get(day)) : null);
    });

    // vagas
    const slotsBox = el('div', { class: 'combo-slots' });
    const addSlot = el('button', { type: 'button', class: 'btn btn--block', onclick: () => {
      slots.push({ label: '', kind: 'pizza', productIds: new Set() });
      paintSlots();
    } }, 'Adicionar vaga');

    const productsOfKind = (kind) => products.filter((p) => p.kind === kind);

    function paintSlots() {
      addSlot.hidden = slots.length >= MAX_SLOTS;
      render(slotsBox, slots.map((slot, i) => slotCard(slot, i)));
    }

    function slotCard(slot, i) {
      const label = el('input', { id: `c-slot-${i}-label`, type: 'text', maxlength: 40, value: slot.label });
      label.addEventListener('input', () => { slot.label = label.value; });
      const kind = el('select', { id: `c-slot-${i}-kind` },
        el('option', { value: 'pizza', selected: slot.kind === 'pizza' }, 'Pizza'),
        el('option', { value: 'drink', selected: slot.kind === 'drink' }, 'Bebida'));
      kind.addEventListener('change', () => { slot.kind = kind.value; slot.productIds.clear(); paintSlots(); });

      const list = productsOfKind(slot.kind);
      const checks = new Map();
      const groups = [];
      for (const slug of [...new Set(list.map((p) => p.categorySlug))]) {
        const inCat = list.filter((p) => p.categorySlug === slug);
        groups.push(el('fieldset', { class: 'combo-products' },
          el('legend', {}, CATEGORY_NAME[slug] ?? slug),
          inCat.map((p) => {
            const box = el('input', { id: `c-slot-${i}-p-${p.id}`, type: 'checkbox', checked: slot.productIds.has(p.id) });
            box.addEventListener('change', () => (box.checked ? slot.productIds.add(p.id) : slot.productIds.delete(p.id)));
            checks.set(p.id, box);
            return el('div', { class: 'form-row form-row--inline' }, box,
              el('label', { for: `c-slot-${i}-p-${p.id}` }, p.name, p.available ? '' : ' (esgotado)'));
          })));
      }
      const shortcuts = SHORTCUTS.filter((s) => s.kind === slot.kind).map((s) =>
        el('button', { type: 'button', class: 'btn btn--small', onclick: () => {
          for (const p of list) {
            if (p.categorySlug !== s.slug) continue;
            slot.productIds.add(p.id);
            checks.get(p.id).checked = true;
          }
        } }, s.label));

      return el('div', { class: 'admin-card combo-slot' },
        el('h3', {}, `Vaga ${i + 1}`),
        el('div', { class: 'form-row' }, el('label', { for: `c-slot-${i}-label` }, 'Rótulo'), label, errorSlot(`slots.${i}.label`)),
        el('div', { class: 'form-row' }, el('label', { for: `c-slot-${i}-kind` }, 'Tipo'), kind, errorSlot(`slots.${i}.kind`)),
        el('p', { class: 'form-help' }, 'Produtos permitidos nesta vaga'),
        el('div', { class: 'date-filter__shortcuts' }, shortcuts),
        groups,
        errorSlot(`slots.${i}.productIds`),
        el('div', { class: 'date-filter__shortcuts' },
          el('button', { type: 'button', class: 'btn btn--small', disabled: i === 0, 'aria-label': `Subir vaga ${i + 1}`, onclick: () => move(i, -1) }, 'Subir'),
          el('button', { type: 'button', class: 'btn btn--small', disabled: i === slots.length - 1, 'aria-label': `Descer vaga ${i + 1}`, onclick: () => move(i, 1) }, 'Descer'),
          el('button', { type: 'button', class: 'btn btn--small btn--danger', disabled: slots.length <= 1, 'aria-label': `Remover vaga ${i + 1}`, onclick: () => { slots.splice(i, 1); paintSlots(); } }, 'Remover')));
    }

    function move(i, delta) {
      const j = i + delta;
      if (j < 0 || j >= slots.length) return;
      [slots[i], slots[j]] = [slots[j], slots[i]];
      paintSlots();
    }

    paintSlots();

    // foto
    const preview = el('img', { class: 'admin-thumb', alt: 'Prévia da foto', width: 56, height: 56, src: combo?.imageUrl ?? null, hidden: !combo?.imageUrl });
    const fileError = el('p', { class: 'form-help', role: 'alert' });
    const file = el('input', { id: 'c-image', type: 'file', accept: IMAGE_TYPES.join(',') });
    file.addEventListener('change', () => {
      fileError.textContent = '';
      const chosen = file.files[0];
      if (!chosen) return;
      if (!IMAGE_TYPES.includes(chosen.type)) {
        fileError.textContent = 'Use foto JPG, PNG ou WEBP.';
        file.value = '';
        return;
      }
      if (chosen.size > MAX_BYTES) {
        fileError.textContent = 'A foto passa de 2 MB. Tire um print ou reduza a imagem.';
        file.value = '';
        return;
      }
      releasePreview();
      previewUrl = URL.createObjectURL(chosen);
      preview.src = previewUrl;
      preview.hidden = false;
    });

    const save = el('button', { type: 'submit', class: 'btn btn--primary btn--block' }, isNew ? 'Criar combo' : 'Salvar');
    const cancel = el('button', { type: 'button', class: 'btn btn--block', onclick: showList }, 'Voltar');

    const form = el('form', { class: 'admin-card', novalidate: true },
      el('h2', {}, isNew ? 'Novo combo' : 'Editar combo'),
      el('div', { class: 'form-row' }, el('label', { for: 'c-name' }, 'Nome'), name, errorSlot('name')),
      el('div', { class: 'form-row' }, el('label', { for: 'c-desc' }, 'Descrição'), description, errorSlot('description')),
      el('div', { class: 'form-row' }, el('label', { for: 'c-price' }, 'Preço (R$)'), price, errorSlot('priceCents')),
      el('fieldset', { class: 'form-row' },
        el('legend', {}, 'Dias da semana'),
        el('div', { class: 'weekdays' }, dayBoxes),
        errorSlot('weekdays')),
      el('h3', {}, 'Vagas'),
      slotsBox, addSlot, errorSlot('slots'),
      el('div', { class: 'form-row' }, el('label', { for: 'c-image' }, 'Foto'), preview, file,
        el('p', { class: 'form-help' }, 'JPG, PNG ou WEBP, até 2 MB. A foto é enviada depois de salvar.'), fileError),
      generalError,
      save);

    function showServerErrors(err) {
      const details = Array.isArray(err.details) ? err.details : [];
      let placed = false;
      for (const d of details) {
        const path = d.path === 'price' ? 'priceCents' : String(d.path);
        const target = errors.get(path);
        if (target) { target.textContent = d.message; placed = true; }
      }
      if (!placed) generalError.textContent = err.message;
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearErrors();
      let body;
      try {
        body = comboPayload({ name: name.value, description: description.value, price: price.value, weekdays: [...days], slots });
      } catch (err) {
        if (err.field !== 'price') throw err;
        errorSlot('priceCents').textContent = err.message;
        price.focus();
        return;
      }
      let finalCombo = combo;
      let stage = 'save';
      try {
        // um único withSaving: o botão fica travado do salvar até o fim do upload
        await withSaving(save, async () => {
          const saved = await adminApi(
            isNew ? '/api/admin/combos' : `/api/admin/combos/${combo.id}`,
            { method: isNew ? 'POST' : 'PUT', body },
          );
          finalCombo = saved?.combo ?? { ...combo, ...body };
          const chosen = file.files[0];
          if (chosen) {
            stage = 'image';
            const data = new FormData();
            data.append('image', chosen);
            const uploaded = await adminApi(`/api/admin/combos/${finalCombo.id}/image`, { method: 'POST', body: data });
            finalCombo = uploaded?.combo ?? finalCombo;
          }
        }, { toast });
      } catch (err) {
        if (stage === 'save') {
          showServerErrors(err);
          return;
        }
        upsert(finalCombo);
        if (isNew) showForm(finalCombo); // combo já existe: segue em edição para tentar a foto de novo
        return;
      }
      upsert(finalCombo);
      showList();
    });

    render(container, form, cancel);
    name.focus();
  }

  function upsert(combo) {
    const index = combos.findIndex((c) => c.id === combo.id);
    if (index === -1) combos.push(combo);
    else combos[index] = { ...combos[index], ...combo };
  }

  await load();
}
