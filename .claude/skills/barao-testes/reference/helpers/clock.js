// Referência de tests/helpers/clock.js — relógio injetável.
// Fortaleza = UTC-3 o ano todo (sem horário de verão): hora local + 3h = UTC.

/** Relógio fixo para createApp({ db, options: { now } }) e createFakeDb({ now }). */
export const fixedNow = (iso) => () => new Date(iso);

// 2026-10-18 é DOMINGO (weekday 0).
export const SUNDAY_20H = '2026-10-18T23:00:00Z';   // domingo 20:00 → aberto (seed 18:00–23:30)
export const SUNDAY_15H = '2026-10-18T18:00:00Z';   // domingo 15:00 → fechado por horário
export const SUNDAY_00H15 = '2026-10-18T03:15:00Z'; // domingo 00:15 (madrugada de sábado para domingo)
