// Referência de tests/helpers/testkit.js — monta app de integração e payloads válidos.
import { createApp } from '../../src/app.js';
import { createFakeDb, IDS } from './fakeDb.js';
import { fixedNow, SUNDAY_20H } from './clock.js';

export { IDS };

export const ADMIN_EMAILS = ['dono@barao.com', 'gerente@barao.com'];

/**
 * App de integração com fakeDb e o MESMO relógio nos dois. Padrão: loja aberta (domingo 20:00),
 * rate limit desligado, ADMIN_EMAILS de teste. Tudo via createApp({ db, options }) — sem process.env.
 *   const { app, db } = makeApp({ settings: { storeOverride: 'closed' } });
 *   const { app } = makeApp({ options: { rateLimit: true } }); // só no teste do 429
 */
export function makeApp({ now = SUNDAY_20H, options = {}, ...dbOverrides } = {}) {
  const clock = fixedNow(now);
  const db = createFakeDb({ now: clock, ...dbOverrides });
  const app = createApp({
    db,
    options: {
      now: clock,
      rateLimit: false,
      adminEmails: ADMIN_EMAILS,
      corsOrigin: 'http://localhost:3000',
      supabaseUrl: 'https://fake.supabase.co',
      supabaseAnonKey: 'fake-anon-key',
      ...options,
    },
  });
  return { app, db };
}

/** Defensivo: formatBRL já troca o NBSP do Intl por espaço; isto garante comparação estável. */
export const normalizeSpaces = (s) => s.replace(/ /g, ' ');

/** Body válido de POST /api/orders (exemplo do contrato). Sobrescreva o que o teste precisa. */
export function validOrder(overrides = {}) {
  return {
    customer: { name: 'João Silva', phone: '85999999999' },
    fulfillment: 'delivery',
    address: { street: 'Rua X', number: '123', district: 'Bairro Y', reference: 'perto da praça' },
    payment: { method: 'cash', changeForCents: 10000 },
    notes: 'Interfone quebrado',
    items: [
      { kind: 'pizza', flavorIds: [IDS.calabresa, IDS.frango], addonIds: [IDS.bordaCatupiry], quantity: 1, notes: 'sem cebola' },
      { kind: 'drink', productId: IDS.coca1lZero, quantity: 2 },
    ],
    ...overrides,
  };
}
