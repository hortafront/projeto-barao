// Referência de tests/helpers/clock.js — relógio injetável.
// Fortaleza = UTC-3 o ano todo (sem horário de verão): hora local + 3h = UTC.

/** Relógio fixo para createApp({ db, options: { now } }) e createFakeDb({ now }). */
export const fixedNow = (iso) => () => new Date(iso);

// 2026-10-18 é DOMINGO (weekday 0).
export const SUNDAY_20H = '2026-10-18T23:00:00Z';   // domingo 20:00 → aberto (seed 18:00–23:30)
export const SUNDAY_15H = '2026-10-18T18:00:00Z';   // domingo 15:00 → fechado por horário
export const SUNDAY_00H15 = '2026-10-18T03:15:00Z'; // domingo 00:15 (madrugada de sábado para domingo)
// Seed: terça (2) e quarta (3) fechadas.
export const MONDAY_20H = '2026-10-19T23:00:00Z';   // segunda 20:00 → aberto
export const TUESDAY_19H = '2026-10-20T22:00:00Z';  // terça 19:00 → fechado (folga)
export const THURSDAY_18H = '2026-10-22T21:00:00Z'; // quinta 18:00 = próxima abertura depois de domingo/segunda
