// Tela Horários: 7 dias (domingo = 0), turno que vira a meia-noite é válido. Um único PUT com os 7 dias.

const DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const hhmm = (value) => String(value ?? '').slice(0, 5);

/** Texto do turno; 'Fechado'; ou null quando abre = fecha (inválido). Fecha <= abre = dia seguinte. */
export function describeShift({ opensAt, closesAt, isClosed }) {
  if (isClosed) return 'Fechado';
  if (opensAt === closesAt) return null;
  return toMin(closesAt) <= toMin(opensAt)
    ? `${opensAt} até ${closesAt} do dia seguinte`
    : `${opensAt} até ${closesAt}`;
}

export async function mount(container, ctx) {
  const { el, render } = await import('/js/dom.js');
  const { adminApi, toast, withSaving } = ctx;

  const { hours } = await adminApi('/api/admin/hours');
  const byDay = new Map(hours.map((h) => [h.weekday, h]));

  const rows = DAY_NAMES.map((name, weekday) => {
    const h = byDay.get(weekday) ?? { opensAt: '18:00', closesAt: '23:30', isClosed: false };
    const closed = el('input', { type: 'checkbox', id: `closed-${weekday}`, checked: !!h.isClosed });
    const opens = el('input', { type: 'time', id: `opens-${weekday}`, value: hhmm(h.opensAt), required: true, 'aria-label': `${name}: abre às` });
    const closes = el('input', { type: 'time', id: `closes-${weekday}`, value: hhmm(h.closesAt), required: true, 'aria-label': `${name}: fecha às` });
    const hint = el('p', { class: 'form-help', id: `hint-${weekday}` });
    const error = el('p', { class: 'field-error', role: 'alert', hidden: true }, 'Abre e fecha não podem ser no mesmo horário.');
    const row = { weekday, name, closed, opens, closes, hint, error };

    const refresh = () => {
      opens.disabled = closes.disabled = closed.checked;
      const text = describeShift(read(row));
      error.hidden = closed.checked || text !== null;
      hint.textContent = text === null ? '' : closed.checked ? '' :
        toMin(closes.value) <= toMin(opens.value) ? `Vira a meia-noite: fecha às ${closes.value} do dia seguinte` : '';
    };
    row.refresh = refresh;
    for (const input of [closed, opens, closes]) input.addEventListener('input', refresh);
    refresh();
    return row;
  });

  function read(row) {
    return { weekday: row.weekday, opensAt: row.opens.value, closesAt: row.closes.value, isClosed: row.closed.checked };
  }

  const copyBtn = el('button', {
    type: 'button',
    class: 'btn btn--small',
    onclick: () => {
      const first = rows[0];
      for (const row of rows.slice(1)) {
        row.closed.checked = first.closed.checked;
        row.opens.value = first.opens.value;
        row.closes.value = first.closes.value;
        row.refresh();
      }
    },
  }, 'Copiar domingo para todos os dias');

  const saveBtn = el('button', { type: 'submit', class: 'btn btn--primary btn--block' }, 'Salvar horários');

  const form = el('form', { class: 'hours-form', novalidate: true },
    rows.map((row) => el('div', { class: 'admin-card' },
      el('div', { class: 'form-row form-row--inline' },
        el('strong', {}, row.name),
        el('label', { class: 'form-row--inline', for: row.closed.id }, row.closed, 'Fechado')),
      el('div', { class: 'form-row form-row--inline' },
        el('label', { for: row.opens.id }, 'Abre'), row.opens,
        el('label', { for: row.closes.id }, 'Fecha'), row.closes),
      row.hint, row.error)),
    el('div', { class: 'form-row' }, copyBtn),
    saveBtn,
    el('p', { class: 'admin-note' }, 'Horário de Fortaleza (UTC−3)'));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const days = rows.map(read);
    rows.forEach((row) => row.refresh());
    if (days.some((d) => describeShift(d) === null)) {
      toast('Corrija os horários marcados antes de salvar.', 'error');
      return;
    }
    try {
      await withSaving(saveBtn, () => adminApi('/api/admin/hours', { method: 'PUT', body: days }), { toast });
    } catch { /* withSaving já avisou */ }
  });

  render(container, el('h1', {}, 'Horários'), form);
}
