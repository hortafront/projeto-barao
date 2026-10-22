// Monta app de integração e payloads válidos.
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createFakeDb, IDS } from './fakeDb.js';
import { fixedNow, SUNDAY_20H } from './clock.js';

export { IDS };

export const ADMIN_EMAILS = ['dono@barao.com', 'gerente@barao.com'];

// Clientes de teste. A e B têm perfil; NEW está autenticado mas SEM perfil (primeiro acesso).
export const CUSTOMER_A = { token: 'token-cliente-a', id: '00000000-0000-4000-8000-0000000000a1', email: 'joao@cliente.com' };
export const CUSTOMER_B = { token: 'token-cliente-b', id: '00000000-0000-4000-8000-0000000000b1', email: 'bia@cliente.com' };
export const CUSTOMER_NEW = { token: 'token-cliente-novo', id: '00000000-0000-4000-8000-0000000000c1', email: 'novo@cliente.com' };
const CUSTOMERS = [CUSTOMER_A, CUSTOMER_B, CUSTOMER_NEW];
const PROFILES = {
  [CUSTOMER_A.id]: { name: 'João Silva', phone: '85999999999' },
  [CUSTOMER_B.id]: { name: 'Bia Costa', phone: '85988887777' },
};

/** Cabeçalho Authorization de um cliente (padrão: CUSTOMER_A). */
export const bearer = (customer = CUSTOMER_A) => ({ Authorization: `Bearer ${customer.token}` });

/**
 * App de integração com fakeDb e o MESMO relógio nos dois. Padrão: loja aberta (domingo 20:00),
 * rate limit desligado, ADMIN_EMAILS de teste. Tudo via createApp({ db, options }) — sem process.env.
 *   const { app, db } = makeApp({ settings: { storeOverride: 'closed' } });
 *   const { app } = makeApp({ options: { rateLimit: true } }); // só no teste do 429
 */
export function makeApp({ now = SUNDAY_20H, options = {}, users = {}, customers = {}, ...dbOverrides } = {}) {
  const clock = fixedNow(now);
  const customerUsers = Object.fromEntries(CUSTOMERS.map((c) => [c.token, { id: c.id, email: c.email }]));
  const db = createFakeDb({
    now: clock,
    ...dbOverrides,
    users: { ...customerUsers, ...users },
    customers: { ...PROFILES, ...customers },
  });
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

/** POST /api/orders autenticado como um cliente (padrão: CUSTOMER_A). */
export function postOrder(app, body, { customer = CUSTOMER_A } = {}) {
  return request(app).post('/api/orders').set(bearer(customer)).send(body);
}

/** Combo padrão de teste: "Combo Clássico", R$ 36,90, quinta (4); pizza clássica + Coca 1L. Sobrescreva o que precisar. */
export function seedCombo(db, overrides = {}) {
  return db.createCombo({
    name: 'Combo Clássico', description: 'Pizza clássica + refrigerante 1L', priceCents: 3690, weekdays: [4],
    slots: [
      { label: 'Escolha sua pizza', kind: 'pizza', productIds: [IDS.mista, IDS.calabresa, IDS.mussarela, IDS.marguerita] },
      { label: 'Escolha o refrigerante', kind: 'drink', productIds: [IDS.coca1l, IDS.coca1lZero] },
    ],
    ...overrides,
  });
}
