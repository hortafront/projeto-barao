// Funções puras do checkout: máscara, montagem do body de POST /api/orders e envio único.
// Sem DOM. O servidor (Zod) é a autoridade; aqui só validação leve para apontar o campo.
import { parseBRLToCents } from '/shared/money.js';

export const onlyDigits = (s) => String(s ?? '').replace(/\D/g, '');

export function maskPhone(value) {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : '';
  const rest = d.slice(2);
  const split = d.length === 11 ? 5 : 4;
  return `(${d.slice(0, 2)}) ${rest.slice(0, split)}${rest.length > split ? `-${rest.slice(split)}` : ''}`;
}

export class FieldError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'FieldError';
    this.field = field;
    this.message = message;
  }
}

const text = (fields, key) => String(fields[key] ?? '').trim();

// ---------- conta do cliente: perfil e endereços salvos ----------
export const NEW_ADDRESS = 'new';

/** Id do endereço padrão (ou o primeiro); sem endereços salvos, 'new'. */
export function defaultAddressChoice(addresses) {
  const list = Array.isArray(addresses) ? addresses : [];
  return (list.find((a) => a.isDefault) ?? list[0])?.id ?? NEW_ADDRESS;
}

/** Rótulo curto de um endereço salvo (também usado em "Minha conta"). */
export function addressLabel(address) {
  const line = `${address.street}, ${address.number}`;
  return address.label ? `${address.label} — ${line}` : `${line} — ${address.district}`;
}

/** Nome e telefone (com máscara) do perfil, para preencher o checkout. */
export function prefillFromMe(me) {
  return { name: me?.profile?.name ?? '', phone: maskPhone(me?.profile?.phone ?? '') };
}

/** Escolha de endereço salvo substitui os inputs de endereço; 'new'/ausente e retirada não mexem em nada. */
export function applyAddressChoice(fields, addresses) {
  const choice = fields.addressChoice;
  if (fields.fulfillment !== 'delivery' || !choice || choice === NEW_ADDRESS) return fields;
  const saved = (addresses ?? []).find((a) => a.id === choice);
  if (!saved) throw new FieldError('addressChoice', 'Escolha um endereço.');
  return {
    ...fields,
    street: saved.street,
    number: saved.number,
    district: saved.district,
    reference: saved.reference ?? '',
  };
}

/** Endereço digitado para guardar na conta (só entrega + "Usar outro endereço" + caixa marcada). */
export function addressToSave(fields) {
  if (fields.fulfillment !== 'delivery' || fields.addressChoice !== NEW_ADDRESS || fields.saveAddress !== 'on') return null;
  return {
    street: text(fields, 'street'),
    number: text(fields, 'number'),
    district: text(fields, 'district'),
    reference: text(fields, 'reference'),
  };
}

function required(fields, key, min, max, message) {
  const value = text(fields, key);
  if (value.length < min || value.length > max) throw new FieldError(key, message);
  return value;
}

/**
 * fields: valores simples do formulário (strings). Lança FieldError no primeiro campo inválido.
 * Nunca envia preço: só ids, quantidades e dados do cliente.
 */
export function buildOrderPayload(fields, items, subtotalCents) {
  const name = required(fields, 'name', 2, 60, 'Informe seu nome (2 a 60 caracteres).');
  const phone = onlyDigits(fields.phone);
  if (!/^\d{10,11}$/.test(phone)) throw new FieldError('phone', 'Telefone com DDD (10 ou 11 dígitos).');

  const fulfillment = fields.fulfillment === 'delivery' ? 'delivery' : 'pickup';
  let address;
  if (fulfillment === 'delivery') {
    address = {
      street: required(fields, 'street', 2, 120, 'Informe a rua.'),
      number: required(fields, 'number', 1, 10, 'Informe o número (até 10 caracteres).'),
      district: required(fields, 'district', 2, 60, 'Informe o bairro.'),
      reference: text(fields, 'reference'),
    };
    if (address.reference.length > 120) throw new FieldError('reference', 'Referência: até 120 caracteres.');
  }

  const method = ['pix', 'cash', 'card'].includes(fields.payment) ? fields.payment : null;
  if (!method) throw new FieldError('payment', 'Escolha a forma de pagamento.');

  let changeForCents = null;
  const changeRaw = method === 'cash' ? text(fields, 'changeFor') : '';
  if (changeRaw) {
    changeForCents = parseBRLToCents(changeRaw);
    if (changeForCents === null) throw new FieldError('changeFor', 'Valor inválido. Ex.: 100 ou 100,00');
    if (changeForCents < subtotalCents) throw new FieldError('changeFor', 'O troco deve ser maior ou igual ao total.');
  }

  const notes = text(fields, 'notes');
  if (notes.length > 280) throw new FieldError('notes', 'Observações: até 280 caracteres.');

  return {
    customer: { name, phone },
    fulfillment,
    ...(address && { address }),
    payment: { method, ...(changeForCents !== null && { changeForCents }) },
    ...(notes && { notes }),
    items,
  };
}

const PATH_TO_FIELD = {
  'customer.name': 'name',
  'customer.phone': 'phone',
  'address.street': 'street',
  'address.number': 'number',
  'address.district': 'district',
  'address.reference': 'reference',
  'payment.method': 'payment',
  'payment.changeForCents': 'changeFor',
  notes: 'notes',
  fulfillment: 'fulfillment',
};

/** details do 400 ([{ path, message }]) -> { campo: mensagem }; o primeiro erro de cada campo vence. */
export function fieldErrorsFromDetails(details) {
  const out = {};
  if (!Array.isArray(details)) return out;
  for (const { path, message } of details) {
    const p = String(path ?? '');
    const field = PATH_TO_FIELD[p] ?? (p.startsWith('items') ? 'items' : null);
    if (field && !(field in out)) out[field] = message;
  }
  return out;
}

/** Envio único: enquanto um POST está pendente, novos submit() não disparam outro e devolvem a mesma promessa. */
export function createOrderSubmitter({ createOrder, onSuccess, onError }) {
  let inFlight = null;
  return {
    get pending() { return inFlight !== null; },
    submit(payload) {
      if (inFlight) return inFlight;
      inFlight = (async () => {
        try {
          const res = await createOrder(payload);
          if (res.ok) onSuccess?.(res.data);
          else onError?.(res.error);
        } finally {
          inFlight = null;
        }
      })();
      return inFlight;
    },
  };
}
