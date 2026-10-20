// shared/money.js — ES module puro, sem dependências (Node + browser)
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** 3499 -> "R$ 34,99". Lança TypeError se não for inteiro seguro. */
export function formatBRL(cents) {
  if (!Number.isSafeInteger(cents)) {
    throw new TypeError(`formatBRL: esperado inteiro em centavos, recebido ${cents}`);
  }
  // Intl usa NBSP (U+00A0) depois de "R$"; normaliza para espaço comum
  // para a mensagem do WhatsApp e os testes baterem com o contrato.
  return BRL.format(cents / 100).replace(/\u00A0/g, ' ');
}

/**
 * "R$ 1.234,56" -> 123456 | "100" -> 10000 | "50,5" -> 5050 | "50.5" -> 5050
 * Retorna null se inválido/vazio/negativo. Aceita só string (input de formulário).
 */
export function parseBRLToCents(input) {
  if (typeof input !== 'string') return null;
  let s = input.replace(/[\s\u00A0]/g, '').replace(/^R\$/i, '');
  if (/^\d+\.\d{1,2}$/.test(s)) s = s.replace('.', ','); // teclado numérico com ponto decimal
  if (!/^(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/.test(s)) return null;
  const [intPart, decPart = ''] = s.replace(/\./g, '').split(',');
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}
