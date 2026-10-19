// tests/unit/hours.service.test.js — aberto/fechado com relógio injetado.
// Assinatura (skill barao-pedido-whatsapp): getStoreStatus(date, hours, override = 'auto', timeZone = 'America/Fortaleza')
//   -> { open, reason: 'hours'|'override_open'|'override_closed', nextOpenAt: string|null, todayHours }
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { getStoreStatus, describeNextOpening } from '../../src/services/hours.service.js';
import { seedHours } from '../helpers/fakeDb.js';
import { SUNDAY_20H, SUNDAY_15H, SUNDAY_00H15, MONDAY_20H, TUESDAY_19H, THURSDAY_18H } from '../helpers/clock.js';

const status = ({ hours = seedHours(), override = 'auto', now }) => getStoreStatus(new Date(now), hours, override);

/** Sábado 18:00→00:30 (vira a meia-noite); domingo fechado; demais 18:00–23:30. */
function hoursWithOvernightSaturday() {
  return seedHours().map((d) => {
    if (d.weekday === 6) return { ...d, opensAt: '18:00', closesAt: '00:30' };
    if (d.weekday === 0) return { ...d, isClosed: true };
    return d;
  });
}

describe('getStoreStatus — horários', () => {
  it('aberto dentro do horário (domingo 20:00)', () => {
    const s = status({ now: SUNDAY_20H });
    assert.equal(s.open, true);
    assert.equal(s.reason, 'hours');
  });

  it('fechado fora do horário (domingo 15:00) e informa próxima abertura', () => {
    const s = status({ now: SUNDAY_15H });
    assert.equal(s.open, false);
    assert.equal(s.reason, 'hours');
    assert.equal(new Date(s.nextOpenAt).toISOString(), '2026-10-18T21:00:00.000Z'); // 18:00 em Fortaleza
  });

  it('limites: abre às 18:00 em ponto, fecha às 23:30 em ponto', () => {
    assert.equal(status({ now: '2026-10-18T21:00:00Z' }).open, true);  // 18:00
    assert.equal(status({ now: '2026-10-19T02:29:59Z' }).open, true);  // 23:29:59
    assert.equal(status({ now: '2026-10-19T02:30:00Z' }).open, false); // 23:30
  });

  it('turno 18:00→00:30 de sábado continua aberto domingo 00:15, mesmo com domingo fechado', () => {
    const s = status({ hours: hoursWithOvernightSaturday(), now: SUNDAY_00H15 });
    assert.equal(s.open, true);
  });

  it('turno que vira a meia-noite fecha às 00:30 em ponto', () => {
    const s = status({ hours: hoursWithOvernightSaturday(), now: '2026-10-18T03:30:00Z' }); // dom 00:30
    assert.equal(s.open, false);
  });

  it('00:15 de domingo fica FECHADO se o sábado fecha às 23:30', () => {
    assert.equal(status({ now: SUNDAY_00H15 }).open, false);
  });

  it('dia marcado is_closed fica fechado no horário normal', () => {
    const hours = seedHours().map((d) => (d.weekday === 0 ? { ...d, isClosed: true } : d));
    assert.equal(status({ hours, now: SUNDAY_20H }).open, false);
  });
});

describe('getStoreStatus — dias do seed (fecha terça e quarta)', () => {
  it('segunda 20:00 → aberto', () => {
    assert.equal(status({ now: MONDAY_20H }).open, true);
  });

  it('terça 19:00 → fechado; nextOpenAt = quinta 18:00 (-03:00), pulando terça e quarta', () => {
    const s = status({ now: TUESDAY_19H });
    assert.equal(s.open, false);
    assert.equal(s.reason, 'hours');
    assert.equal(s.todayHours.isClosed, true);
    assert.equal(new Date(s.nextOpenAt).toISOString(), new Date(THURSDAY_18H).toISOString());
    assert.equal(new Date(s.nextOpenAt).toISOString(), new Date('2026-10-22T18:00:00-03:00').toISOString());
  });

  it('segunda 23:30 (fechou) → nextOpenAt = quinta 18:00', () => {
    const s = status({ now: '2026-10-20T02:30:00Z' }); // seg 23:30
    assert.equal(s.open, false);
    assert.equal(new Date(s.nextOpenAt).toISOString(), new Date(THURSDAY_18H).toISOString());
  });
});

describe('getStoreStatus — override manual', () => {
  it('override "closed" fecha mesmo dentro do horário', () => {
    const s = status({ override: 'closed', now: SUNDAY_20H });
    assert.deepEqual([s.open, s.reason, s.nextOpenAt], [false, 'override_closed', null]);
  });

  it('override "open" abre mesmo fora do horário', () => {
    const s = status({ override: 'open', now: SUNDAY_15H });
    assert.deepEqual([s.open, s.reason], [true, 'override_open']);
  });
});

/** Sexta 18:00→00:30 (vira a meia-noite); demais dias como no seed. */
function hoursWithOvernightFriday(overrides = {}) {
  return seedHours().map((d) => (d.weekday === 5 ? { ...d, opensAt: '18:00', closesAt: '00:30', ...overrides } : d));
}

describe('getStoreStatus — turno de sexta 18:00→00:30 (spec §7)', () => {
  it('sexta 23:50 → aberto', () => {
    assert.equal(status({ hours: hoursWithOvernightFriday(), now: '2026-10-17T02:50:00Z' }).open, true);
  });

  it('sábado 00:10 → aberto (turno de sexta)', () => {
    assert.equal(status({ hours: hoursWithOvernightFriday(), now: '2026-10-17T03:10:00Z' }).open, true);
  });

  it('sábado 00:30 → fechado (intervalo [abre, fecha))', () => {
    assert.equal(status({ hours: hoursWithOvernightFriday(), now: '2026-10-17T03:30:00Z' }).open, false);
  });

  it('sexta isClosed → sábado 00:10 fechado', () => {
    assert.equal(status({ hours: hoursWithOvernightFriday({ isClosed: true }), now: '2026-10-17T03:10:00Z' }).open, false);
  });
});

describe('getStoreStatus — nextOpenAt e todayHours', () => {
  it('sábado 23:30 (fechou) → nextOpenAt = domingo 18:00', () => {
    const s = status({ now: '2026-10-18T02:30:00Z' });
    assert.equal(s.open, false);
    assert.equal(s.nextOpenAt, '2026-10-18T21:00:00.000Z');
  });

  it('todos os dias isClosed → nextOpenAt null', () => {
    const hours = seedHours().map((d) => ({ ...d, isClosed: true }));
    const s = status({ hours, now: SUNDAY_20H });
    assert.equal(s.open, false);
    assert.equal(s.nextOpenAt, null);
  });

  it('override closed → nextOpenAt null e reason override_closed', () => {
    const s = status({ override: 'closed', now: SUNDAY_15H });
    assert.equal(s.nextOpenAt, null);
    assert.equal(s.reason, 'override_closed');
  });

  it('terça 19:00 → nextOpenAt quinta 18:00 e todayHours da terça', () => {
    const s = status({ now: TUESDAY_19H });
    assert.equal(s.nextOpenAt, '2026-10-22T21:00:00.000Z');
    assert.deepEqual(s.todayHours, { weekday: 2, opensAt: '18:00', closesAt: '23:30', isClosed: true });
  });
});

describe('describeNextOpening', () => {
  const d = (nextOpenAt, now) => describeNextOpening(nextOpenAt, new Date(now), 'America/Fortaleza');

  it('mesmo dia → "hoje às 18:00"', () => {
    assert.equal(d('2026-10-18T21:00:00.000Z', SUNDAY_15H), 'hoje às 18:00');
  });

  it('dia seguinte → "amanhã às 18:00" (sábado 23:30 → domingo 18:00)', () => {
    assert.equal(d('2026-10-18T21:00:00.000Z', '2026-10-18T02:30:00Z'), 'amanhã às 18:00');
  });

  it('dias depois → nome do dia sem "-feira" (segunda 23:30 → quinta 18:00)', () => {
    assert.equal(d('2026-10-22T21:00:00.000Z', '2026-10-20T02:30:00Z'), 'quinta às 18:00');
  });
});

describe('fuso do processo é irrelevante', () => {
  it('resultado idêntico com TZ=Pacific/Kiritimati', () => {
    const script = `
      import { getStoreStatus } from './src/services/hours.service.js';
      import { seedHours } from './tests/helpers/fakeDb.js';
      console.log(JSON.stringify(getStoreStatus(new Date('2026-10-20T22:00:00Z'), seedHours())));
    `;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ: 'Pacific/Kiritimati' },
      encoding: 'utf8',
    });
    const expected = getStoreStatus(new Date('2026-10-20T22:00:00Z'), seedHours());
    assert.deepEqual(JSON.parse(out), expected);
  });
});
