// Tela Loja: estado atual, override auto/open/closed (com confirmação) e número do WhatsApp (com máscara).

/** "5585999990000" -> "(85) 99999-0000". Aceita digitação parcial e "+55". */
export function maskPhoneBR(value) {
  let d = String(value ?? '').replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  d = d.slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  const mid = d.length === 11 ? 7 : 6;
  return `(${d.slice(0, 2)}) ${d.slice(2, mid)}${d.length > mid ? `-${d.slice(mid)}` : ''}`;
}

/** "(85) 99999-9999" -> "5585999999999"; inválido -> null. Mesmo formato do servidor: ^55\d{10,11}$ */
export function toWhatsAppDigits(value) {
  let d = String(value ?? '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  return /^\d{10,11}$/.test(d) ? `55${d}` : null;
}

const OPTIONS = [
  { value: 'auto', label: 'Automático (segue horários)' },
  { value: 'open', label: 'Forçar aberta' },
  { value: 'closed', label: 'Forçar fechada' },
];

const CONFIRM = {
  open: {
    title: 'Forçar loja ABERTA?',
    body: 'A loja ficará aberta para pedidos mesmo fora do horário, até você voltar para Automático.',
    confirmLabel: 'Abrir a loja',
    danger: false,
  },
  closed: {
    title: 'Forçar loja FECHADA?',
    body: 'Os clientes NÃO conseguirão fazer pedidos até você voltar para Automático.',
    confirmLabel: 'Fechar a loja',
    danger: true,
  },
};

const STATUS_REASON = {
  hours: 'Seguindo os horários',
  override_open: 'Forçada aberta',
  override_closed: 'Forçada fechada',
};

export async function mount(container, ctx) {
  const { el, render } = await import('/js/dom.js');
  const { adminApi, toast, confirmDialog, withSaving, refreshBanner } = ctx;

  const settings = await adminApi('/api/admin/settings');

  // ---- estado atual (GET /api/status é público)
  const pill = el('span', { class: 'status-pill' });
  const reason = el('p', { class: 'form-help' });
  async function loadStatus() {
    try {
      const res = await fetch('/api/status');
      const status = await res.json();
      pill.textContent = status.open ? 'Aberta agora' : 'Fechada agora';
      pill.className = `status-pill ${status.open ? 'status-pill--confirmed' : 'status-pill--canceled'}`;
      reason.textContent = STATUS_REASON[status.reason] ?? '';
    } catch {
      pill.textContent = 'Estado indisponível';
      pill.className = 'status-pill';
      reason.textContent = '';
    }
  }

  // ---- override
  let current = settings.storeOverride ?? 'auto';
  const radios = OPTIONS.map((opt) => el('input', { type: 'radio', name: 'storeOverride', value: opt.value, checked: opt.value === current }));
  const overrideBox = el('fieldset', { class: 'store-override' },
    el('legend', {}, 'Funcionamento da loja'),
    OPTIONS.map((opt, i) => el('label', { class: 'radio-card' }, radios[i], el('span', {}, opt.label))));

  overrideBox.addEventListener('change', async (event) => {
    const next = event.target.value;
    if (next === current) return;
    const restore = () => { radios.forEach((r) => { r.checked = r.value === current; }); };
    if (CONFIRM[next]) {
      const ok = await confirmDialog(CONFIRM[next]);
      if (!ok) return restore();
    }
    overrideBox.disabled = true;
    try {
      await withSaving(overrideSave, () => adminApi('/api/admin/settings', { method: 'PUT', body: { storeOverride: next } }), { toast });
      current = next;
    } catch {
      restore();
    } finally {
      overrideBox.disabled = false;
    }
    await Promise.all([loadStatus(), refreshBanner?.()]);
  });
  // withSaving precisa de um botão para o estado "Salvando…"; aqui é um rótulo invisível ao usuário.
  const overrideSave = el('button', { type: 'button', hidden: true }, 'Salvar');

  // ---- WhatsApp
  const phone = el('input', {
    type: 'tel', id: 'whatsapp', name: 'whatsapp', inputmode: 'numeric', autocomplete: 'off',
    value: maskPhoneBR(settings.whatsappNumber), 'aria-describedby': 'whatsapp-help whatsapp-error',
  });
  const phoneError = el('p', { class: 'field-error', id: 'whatsapp-error', role: 'alert', hidden: true });
  const phoneBtn = el('button', { type: 'submit', class: 'btn btn--primary' }, 'Salvar número');
  phone.addEventListener('input', () => { phone.value = maskPhoneBR(phone.value); phoneError.hidden = true; });

  const showPhoneError = (message) => { phoneError.textContent = message; phoneError.hidden = false; };

  const phoneForm = el('form', { class: 'whatsapp-form', novalidate: true },
    el('div', { class: 'form-row' },
      el('label', { for: 'whatsapp' }, 'Número do WhatsApp'),
      phone,
      el('p', { class: 'form-help', id: 'whatsapp-help' }, 'É para este número que os pedidos chegam.'),
      phoneError),
    phoneBtn);

  phoneForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const digits = toWhatsAppDigits(phone.value);
    if (!digits) return showPhoneError('Número inválido. Use DDD + número, ex.: (85) 99999-9999.');
    const ok = await confirmDialog({
      title: 'Trocar o número do WhatsApp?',
      body: `Os próximos pedidos serão enviados para ${maskPhoneBR(digits)}. Confira: número errado = pedido perdido.`,
      confirmLabel: 'Salvar número',
    });
    if (!ok) return undefined;
    try {
      await withSaving(phoneBtn, () => adminApi('/api/admin/settings', { method: 'PUT', body: { whatsappNumber: digits } }), { toast });
    } catch (err) {
      if (err?.status === 400) showPhoneError(err.message);
    }
    return undefined;
  });

  render(container,
    el('h1', {}, 'Loja'),
    el('div', { class: 'stat-block' }, el('div', { class: 'stat-block__label' }, 'Agora'), pill, reason),
    overrideBox,
    overrideSave,
    el('h2', {}, 'WhatsApp'),
    phoneForm);
  await loadStatus();
}
