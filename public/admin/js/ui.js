import { el, openDialog } from '/js/dom.js';

let toastNode;
let toastTimer;

/** Aviso curto (role=status). kind: 'success' | 'error' | 'info'. */
export function toast(message, kind = 'info') {
  if (!toastNode) {
    toastNode = el('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastNode);
  }
  toastNode.textContent = message;
  toastNode.className = `toast toast--${kind} is-visible`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastNode.classList.remove('is-visible'), kind === 'error' ? 6000 : 2500);
}

/** Diálogo de confirmação. Resolve true só se o dono confirmar; Esc/fora/Cancelar = false. */
export function confirmDialog({ title, body, confirmLabel = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    const cancel = el('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Cancelar');
    const ok = el('button', {
      type: 'button',
      class: danger ? 'btn btn--danger' : 'btn btn--primary',
      onclick: () => { answer = true; close(); },
    }, confirmLabel);
    const dialog = el('dialog', { class: 'modal confirm-dialog', 'aria-labelledby': 'confirm-title' },
      el('div', { class: 'confirm-dialog__inner' },
        el('h2', { id: 'confirm-title' }, title),
        body ? el('p', {}, body) : null,
        el('div', { class: 'confirm-dialog__actions' }, cancel, ok)));
    document.body.append(dialog);
    const close = openDialog(dialog, {
      initialFocus: cancel,
      onClose: () => { dialog.remove(); resolve(answer); },
    });
  });
}
