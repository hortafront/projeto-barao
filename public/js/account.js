// Janela "Minha conta": perfil, endereços salvos, sair e excluir conta.
// Só DOM e orquestração; o servidor valida tudo e decide quem é o endereço padrão.
import { el, openDialog, render } from './dom.js';
import { addressLabel, maskPhone, onlyDigits } from './order-payload.js';

const MAX_ADDRESSES = 10;
const LIMIT_MESSAGE = 'Você pode salvar até 10 endereços.';
const DELETE_ACCOUNT_TEXT = 'Isso apaga seus dados e endereços. Seus pedidos anteriores continuam registrados na pizzaria.';
const RELOAD_ERROR = 'Não foi possível carregar sua conta. Verifique sua internet e tente de novo.';

const PROFILE_FIELDS = ['name', 'phone'];
const ADDRESS_FIELDS = ['label', 'street', 'number', 'district', 'reference'];

/** details do 400 ([{ path, message }]) -> { campo: mensagem } só para os campos do formulário. */
function detailErrors(details, fields) {
  const out = {};
  if (!Array.isArray(details)) return out;
  for (const { path, message } of details) {
    const key = String(path ?? '').split('.').pop();
    if (fields.includes(key) && !(key in out)) out[key] = message;
  }
  return out;
}

function field({ id, label, error = '', ...attrs }) {
  const input = el('input', { id, name: id, ...attrs });
  const err = el('p', { class: 'field-error', id: `${id}-error`, 'aria-live': 'polite' }, error);
  if (error) {
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', err.id);
  }
  return { input, node: el('div', { class: 'field' }, el('label', { for: id }, label), input, err) };
}

export function initAccount({ dialog, account, auth, toast = () => {} }) {
  let me = null;
  let view = { name: 'main' }; // main | address ({ address } = null para novo)
  let profileErrors = {};
  let profileDraft = null;
  let addressErrors = {};
  let addressDraft = {};
  let formError = '';
  let busy = false;
  let closeDialog = null;

  function close() { closeDialog?.(); }

  /** Confirmação própria (sem window.confirm). Resolve true/false. */
  function confirmDialog({ title, text, confirmLabel }) {
    return new Promise((resolve) => {
      const box = el('dialog', { class: 'modal confirm', 'aria-labelledby': 'confirm-title' });
      document.body.append(box);
      let result = false;
      const closeBox = openDialog(box, {
        onClose: () => {
          box.remove();
          if (dialog.open) document.body.classList.add('is-locked');
          resolve(result);
        },
      });
      const yes = el('button', { type: 'button', class: 'btn btn--danger', onclick: () => { result = true; closeBox(); } }, confirmLabel);
      const no = el('button', { type: 'button', class: 'btn', onclick: () => closeBox() }, 'Cancelar');
      render(box, el('div', { class: 'sheet confirm__sheet' },
        el('div', { class: 'sheet__body' },
          el('h2', { id: 'confirm-title', class: 'sheet__title' }, title),
          el('p', {}, text),
          el('div', { class: 'confirm__actions' }, no, yes))));
      no.focus();
    });
  }

  async function reload() {
    const fresh = await account.loadMe();
    if (!fresh) return false;
    me = fresh;
    return true;
  }

  /** Roda a chamada, recarrega GET /api/me e repinta. Devolve true em sucesso. */
  async function mutate(call, onError) {
    if (busy) return false;
    busy = true;
    paint();
    try {
      const res = await call();
      if (!res.ok) { onError(res.error); return false; }
      if (!(await reload())) { formError = RELOAD_ERROR; return false; }
      return true;
    } finally {
      busy = false;
      if (dialog.open) paint();
    }
  }

  // ---------- perfil ----------
  function profileSection() {
    const draft = profileDraft ?? { name: me.profile?.name ?? '', phone: maskPhone(me.profile?.phone ?? '') };
    const name = field({ id: 'acc-name', label: 'Nome', type: 'text', autocomplete: 'name', maxlength: '60', required: true, value: draft.name, error: profileErrors.name });
    const phone = field({
      id: 'acc-phone', label: 'Telefone (WhatsApp)', type: 'tel', inputmode: 'numeric', autocomplete: 'tel-national',
      placeholder: '(85) 99999-9999', required: true, value: draft.phone, error: profileErrors.phone,
      oninput: (event) => { event.target.value = maskPhone(event.target.value); },
    });
    const general = el('p', { class: 'field-error', 'aria-live': 'polite' }, profileErrors._general ?? '');
    return el('form', {
      class: 'account-section auth-form',
      novalidate: true,
      onsubmit: async (event) => {
        event.preventDefault();
        profileDraft = { name: name.input.value, phone: phone.input.value };
        profileErrors = {};
        const ok = await mutate(
          () => account.customerApi('/api/me', { method: 'PUT', body: { name: name.input.value.trim(), phone: onlyDigits(phone.input.value) } }),
          (error) => {
            profileErrors = detailErrors(error.details, PROFILE_FIELDS);
            if (!Object.keys(profileErrors).length) profileErrors._general = error.message;
          },
        );
        if (ok) { profileDraft = null; toast('Dados salvos.'); }
      },
    },
    el('h3', { class: 'account-section__title' }, 'Seus dados'),
    el('p', { class: 'account-email' }, me.email),
    name.node, phone.node, general,
    el('button', { type: 'submit', class: 'btn btn--primary', disabled: busy }, busy ? 'Salvando…' : 'Salvar'));
  }

  // ---------- endereços ----------
  function addressRow(address) {
    return el('li', { class: 'address-item' },
      el('div', { class: 'address-item__text' },
        el('p', { class: 'address-item__label' },
          addressLabel(address),
          address.isDefault && el('span', { class: 'badge badge--open' }, 'Padrão')),
        address.reference && el('p', { class: 'address-item__ref' }, address.reference)),
      el('div', { class: 'address-item__actions' },
        el('button', { type: 'button', class: 'btn btn--small', disabled: busy, onclick: () => openAddressForm(address) }, 'Editar'),
        !address.isDefault && el('button', {
          type: 'button', class: 'btn btn--small', disabled: busy,
          onclick: () => mutate(
            () => account.customerApi(`/api/me/addresses/${address.id}/default`, { method: 'PATCH' }),
            (error) => { formError = error.message; },
          ),
        }, 'Tornar padrão'),
        el('button', {
          type: 'button', class: 'btn btn--small btn--danger', disabled: busy,
          onclick: async () => {
            const yes = await confirmDialog({ title: 'Apagar endereço?', text: addressLabel(address), confirmLabel: 'Apagar' });
            if (!yes) return;
            formError = '';
            await mutate(
              () => account.customerApi(`/api/me/addresses/${address.id}`, { method: 'DELETE' }),
              (error) => { formError = error.message; },
            );
          },
        }, 'Apagar')));
  }

  function addressesSection() {
    const full = me.addresses.length >= MAX_ADDRESSES;
    return el('section', { class: 'account-section' },
      el('h3', { class: 'account-section__title' }, 'Endereços salvos'),
      me.addresses.length
        ? el('ul', { class: 'address-list' }, me.addresses.map(addressRow))
        : el('p', { class: 'account-empty' }, 'Você ainda não salvou nenhum endereço.'),
      el('button', {
        type: 'button', class: 'btn', disabled: busy || full, 'aria-describedby': full ? 'acc-limit' : undefined,
        onclick: () => openAddressForm(null),
      }, 'Adicionar endereço'),
      el('p', { id: 'acc-limit', class: 'field__hint', hidden: !full }, LIMIT_MESSAGE));
  }

  function openAddressForm(address) {
    addressErrors = {};
    formError = '';
    addressDraft = {
      label: address?.label ?? '', street: address?.street ?? '', number: address?.number ?? '',
      district: address?.district ?? '', reference: address?.reference ?? '',
    };
    view = { name: 'address', address };
    paint();
    dialog.querySelector('#acc-street')?.focus();
  }

  function backToMain() {
    view = { name: 'main' };
    formError = '';
    paint();
  }

  function addressForm() {
    const { address } = view;
    const d = addressDraft;
    const e = addressErrors;
    const label = field({ id: 'acc-label', label: 'Apelido (opcional)', type: 'text', maxlength: '30', placeholder: 'Casa, Trabalho…', value: d.label, error: e.label });
    const street = field({ id: 'acc-street', label: 'Rua', type: 'text', autocomplete: 'address-line1', required: true, value: d.street, error: e.street });
    const number = field({ id: 'acc-number', label: 'Número', type: 'text', required: true, value: d.number, error: e.number });
    const district = field({ id: 'acc-district', label: 'Bairro', type: 'text', required: true, value: d.district, error: e.district });
    const reference = field({ id: 'acc-reference', label: 'Ponto de referência (opcional)', type: 'text', value: d.reference, error: e.reference });
    const general = el('p', { class: 'field-error', 'aria-live': 'polite' }, formError);
    return el('form', {
      class: 'account-section auth-form',
      novalidate: true,
      onsubmit: async (event) => {
        event.preventDefault();
        addressDraft = {
          label: label.input.value, street: street.input.value, number: number.input.value,
          district: district.input.value, reference: reference.input.value,
        };
        const body = Object.fromEntries(ADDRESS_FIELDS.map((key) => [key, addressDraft[key].trim()]));
        addressErrors = {};
        formError = '';
        const ok = await mutate(
          () => account.customerApi(
            address ? `/api/me/addresses/${address.id}` : '/api/me/addresses',
            { method: address ? 'PUT' : 'POST', body },
          ),
          (error) => {
            addressErrors = detailErrors(error.details, ADDRESS_FIELDS);
            if (!Object.keys(addressErrors).length) formError = error.message;
          },
        );
        if (ok) { view = { name: 'main' }; paint(); toast(address ? 'Endereço atualizado.' : 'Endereço salvo.'); }
      },
    },
    el('h3', { class: 'account-section__title' }, address ? 'Editar endereço' : 'Novo endereço'),
    label.node, street.node, el('div', { class: 'field-row' }, number.node, district.node), reference.node, general,
    el('div', { class: 'account-actions' },
      el('button', { type: 'button', class: 'btn', onclick: backToMain }, 'Cancelar'),
      el('button', { type: 'submit', class: 'btn btn--primary', disabled: busy }, busy ? 'Salvando…' : 'Salvar endereço')));
  }

  // ---------- sair / excluir ----------
  async function signOut() {
    try { await auth.signOut(); } catch { /* a sessão local é limpa de qualquer forma */ }
    close();
    toast('Você saiu da sua conta.');
  }

  async function deleteAccount() {
    const yes = await confirmDialog({ title: 'Excluir minha conta?', text: DELETE_ACCOUNT_TEXT, confirmLabel: 'Excluir conta' });
    if (!yes) return;
    formError = '';
    busy = true;
    paint();
    const res = await account.customerApi('/api/me', { method: 'DELETE' });
    busy = false;
    if (!res.ok) { formError = res.error.message; paint(); return; }
    try { await auth.signOut({ scope: 'local' }); } catch { /* a conta já foi apagada no servidor */ }
    close();
    toast('Conta excluída.');
  }

  function footerSection() {
    return el('section', { class: 'account-section account-section--end' },
      formError && el('p', { class: 'field-error', 'aria-live': 'polite' }, formError),
      el('button', { type: 'button', class: 'btn', disabled: busy, onclick: signOut }, 'Sair'),
      el('button', { type: 'button', class: 'link-btn account-delete', disabled: busy, onclick: deleteAccount }, 'Excluir minha conta'));
  }

  function paint() {
    const onForm = view.name === 'address';
    render(dialog, el('div', { class: 'sheet account' },
      el('header', { class: 'sheet__head' },
        el('h2', { id: 'account-title', class: 'sheet__title' }, onForm ? 'Endereço' : 'Minha conta'),
        el('button', { type: 'button', class: 'sheet__close', 'aria-label': 'Fechar', onclick: close }, '×')),
      el('div', { class: 'sheet__body' },
        onForm ? addressForm() : [profileSection(), addressesSection(), footerSection()])));
  }

  function show(loaded) {
    me = loaded;
    view = { name: 'main' };
    profileErrors = {};
    profileDraft = null;
    formError = '';
    busy = false;
    paint();
    closeDialog = openDialog(dialog, {});
  }

  /** Abre pelo gate: sem login ou com perfil incompleto, passa antes pelas janelas de T10. */
  function open() {
    if (dialog.open) return;
    account.gate.run((loaded) => show(loaded));
  }

  return { open };
}
