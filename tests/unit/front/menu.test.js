import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../helpers/browserAliases.js';

const { describeNextOpening, storeBannerText } = await import('../../../public/js/menu.js');

const TUESDAY_19H = new Date('2026-10-20T22:00:00.000Z'); // terça 19:00 em Fortaleza (UTC-3)
const SUNDAY_15H = new Date('2026-10-18T18:00:00.000Z'); // domingo 15:00 em Fortaleza

test('loja aberta não tem banner', () => {
  assert.equal(storeBannerText({ open: true, reason: 'hours', nextOpenAt: null }, TUESDAY_19H), null);
  assert.equal(storeBannerText(null, TUESDAY_19H), null);
});

test('fechada: informa o dia da semana e a hora da próxima abertura', () => {
  const status = { open: false, reason: 'hours', nextOpenAt: '2026-10-22T21:00:00.000Z' };
  assert.equal(storeBannerText(status, TUESDAY_19H), 'Estamos fechados agora — abrimos quinta às 18:00.');
});

test('fechada: abertura no mesmo dia vira "hoje"', () => {
  const status = { open: false, reason: 'hours', nextOpenAt: '2026-10-18T21:00:00.000Z' };
  assert.equal(storeBannerText(status, SUNDAY_15H), 'Estamos fechados agora — abrimos hoje às 18:00.');
});

test('fechada: abertura no dia seguinte vira "amanhã"', () => {
  assert.equal(describeNextOpening('2026-10-21T21:00:00.000Z', TUESDAY_19H), 'amanhã às 18:00');
});

test('override fechado não promete horário', () => {
  const status = { open: false, reason: 'override_closed', nextOpenAt: null };
  assert.equal(storeBannerText(status, TUESDAY_19H), 'Estamos fechados no momento.');
});

test('fechada sem nextOpenAt cai na mensagem genérica', () => {
  const status = { open: false, reason: 'hours', nextOpenAt: null };
  assert.equal(storeBannerText(status, TUESDAY_19H), 'Estamos fechados no momento.');
});

test('resultado independe do TZ do processo', () => {
  const status = { open: false, reason: 'hours', nextOpenAt: '2026-10-22T21:00:00.000Z' };
  const previous = process.env.TZ;
  try {
    for (const tz of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles']) {
      process.env.TZ = tz;
      assert.equal(storeBannerText(status, TUESDAY_19H), 'Estamos fechados agora — abrimos quinta às 18:00.');
    }
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});
