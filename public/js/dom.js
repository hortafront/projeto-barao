// Implementação de referência de public/js/dom.js
// Regra: dados (nome, descrição, observação, nome do cliente...) entram SEMPRE como texto.
// Nunca innerHTML / insertAdjacentHTML / outerHTML com dados.

const SAFE_URL = /^(https?:\/\/|\/(?!\/)|\.{1,2}\/|#|mailto:|tel:|blob:)/i;
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'poster']);
const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden', 'indeterminate']);

/**
 * Cria um elemento.
 *   el('button', { class: 'btn', type: 'button', onclick: fn, 'aria-label': 'Adicionar' }, 'Adicionar')
 * attrs:
 *   class        -> className
 *   dataset      -> objeto copiado para node.dataset
 *   on<evento>   -> addEventListener (função)
 *   value/checked/disabled/selected/hidden -> propriedade DOM
 *   href/src     -> só URLs seguras (http(s), relativas, #, mailto:, tel:, blob:) — javascript: é descartado
 *   null/undefined/false -> atributo omitido; true -> atributo booleano
 * children: Node | string | number | null | false | arrays (achatadas). Strings viram texto.
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (key === 'innerHTML' || key === 'outerHTML') {
      throw new Error('dom.el: innerHTML proibido — passe texto como filho');
    }
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
      continue;
    }
    if (value == null || value === false) continue;
    if (PROPS.has(key)) {
      node[key] = value;
      continue;
    }
    if (key === 'class') node.className = String(value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (URL_ATTRS.has(key)) {
      const url = String(value);
      if (SAFE_URL.test(url)) node.setAttribute(key, url);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  appendChildren(node, children);
  return node;
}

export function appendChildren(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : String(child)); // append(string) cria Text node
  }
  return node;
}

/** Substitui todo o conteúdo de um container. */
export function render(container, ...children) {
  container.replaceChildren();
  return appendChildren(container, children);
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Anuncia texto numa região aria-live (ex.: total do carrinho, erros). */
export function announce(region, text) {
  region.textContent = '';
  // microtask garante que leitores de tela percebam a troca mesmo com texto igual
  queueMicrotask(() => { region.textContent = text; });
}

/**
 * Abre um <dialog> modal com foco preso (showModal deixa o resto da página inerte),
 * Esc fecha (evento 'cancel'), e o foco volta para quem abriu.
 * Retorna uma função close().
 */
export function openDialog(dialog, { onClose, initialFocus } = {}) {
  const opener = document.activeElement;
  const listeners = new AbortController(); // remove os listeners ao fechar (sem acumular)
  const close = () => { if (dialog.open) dialog.close(); };
  dialog.addEventListener('close', () => {
    listeners.abort();
    document.body.classList.remove('is-locked');
    onClose?.();
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  }, { once: true });
  // clique no backdrop fecha
  dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); }, { signal: listeners.signal });
  document.body.classList.add('is-locked'); // .is-locked { overflow: hidden; }
  dialog.showModal();
  (initialFocus ?? dialog.querySelector('[autofocus], button, input, select, textarea'))?.focus();
  return close;
}
