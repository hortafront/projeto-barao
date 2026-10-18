# Referência — `src/services/hours.service.js`

`hours` = saída de `db.getHours()`: `[{ weekday: 0..6 (0 = domingo), opensAt: '18:00' | '18:00:00', closesAt, isClosed }]`.
`override` = `settings.storeOverride`: `'auto' | 'open' | 'closed'`.

```js
// src/services/hours.service.js — puro, sem I/O
export const DEFAULT_TZ = 'America/Fortaleza';

const WEEKDAY = Object.freeze({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 });
const formatters = new Map();

function formatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-US', {
      timeZone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }));
  }
  return formatters.get(timeZone);
}

/** Data/hora "de parede" no fuso da loja. minutes = minutos desde 00:00 local. */
export function getLocalParts(date, timeZone = DEFAULT_TZ) {
  const p = Object.fromEntries(formatter(timeZone).formatToParts(date).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    weekday: WEEKDAY[p.weekday],
    minutes: (Number(p.hour) % 24) * 60 + Number(p.minute),
  };
}

/** '18:00' | '18:00:00' -> 1080 */
export function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

function shiftOf(day) {
  if (!day || day.isClosed) return null;
  const start = toMinutes(day.opensAt);
  const end = toMinutes(day.closesAt);
  return { start, end, crossesMidnight: end <= start }; // end == start => 24h
}

function indexByWeekday(hours) {
  return new Map(hours.map((h) => [h.weekday, h]));
}

export function isOpenAt(date, hours, override = 'auto', timeZone = DEFAULT_TZ) {
  if (override === 'open') return true;
  if (override === 'closed') return false;

  const { weekday, minutes } = getLocalParts(date, timeZone);
  const byDay = indexByWeekday(hours);

  const today = shiftOf(byDay.get(weekday));
  if (today) {
    if (!today.crossesMidnight && minutes >= today.start && minutes < today.end) return true;
    if (today.crossesMidnight && minutes >= today.start) return true;
  }
  // turno de ontem que passou da meia-noite (ex.: sábado 18:00 -> domingo 00:30)
  const yesterday = shiftOf(byDay.get((weekday + 6) % 7));
  return Boolean(yesterday?.crossesMidnight && minutes < yesterday.end);
}

/** Próxima abertura (ISO UTC) nos próximos 7 dias, ou null. */
export function findNextOpenAt(date, hours, timeZone = DEFAULT_TZ) {
  const local = getLocalParts(date, timeZone);
  const nowMs = Math.floor(date.getTime() / 60000) * 60000;
  // offset do fuso em minutos (Fortaleza = -180, fixo, sem horário de verão)
  const offsetMin = Math.round(
    (Date.UTC(local.year, local.month - 1, local.day) + local.minutes * 60000 - nowMs) / 60000,
  );
  const byDay = indexByWeekday(hours);
  for (let k = 0; k <= 7; k += 1) {
    const shift = shiftOf(byDay.get((local.weekday + k) % 7));
    if (!shift) continue;
    const utcMs = Date.UTC(local.year, local.month - 1, local.day + k, 0, shift.start) - offsetMin * 60000;
    if (utcMs > date.getTime()) return new Date(utcMs).toISOString();
  }
  return null;
}

export function getStoreStatus(date, hours, override = 'auto', timeZone = DEFAULT_TZ) {
  const open = isOpenAt(date, hours, override, timeZone);
  const reason = override === 'open' ? 'override_open' : override === 'closed' ? 'override_closed' : 'hours';
  const { weekday } = getLocalParts(date, timeZone);
  const today = hours.find((h) => h.weekday === weekday) ?? null;
  return {
    open,
    reason,
    // com override 'closed' não dá para prever a reabertura (depende do admin)
    nextOpenAt: open || override === 'closed' ? null : findNextOpenAt(date, hours, timeZone),
    todayHours: today && {
      weekday: today.weekday,
      opensAt: String(today.opensAt).slice(0, 5),
      closesAt: String(today.closesAt).slice(0, 5),
      isClosed: today.isClosed,
    },
  };
}
```

## Casos de teste (Fortaleza = UTC-3; datas em UTC)
Horário: todos os dias 18:00–00:30, exceto segunda (`weekday 1`) `isClosed`.
| Instante UTC | Local Fortaleza | Esperado |
|---|---|---|
| `2026-10-17T20:59:00Z` | sáb 17:59 | fechado, `nextOpenAt = 2026-10-17T21:00:00.000Z` |
| `2026-10-17T21:00:00Z` | sáb 18:00 | aberto |
| `2026-10-18T02:59:00Z` | sáb 23:59 | aberto |
| `2026-10-18T03:10:00Z` | dom 00:10 | aberto (turno de sábado) |
| `2026-10-18T03:30:00Z` | dom 00:30 | fechado (intervalo `[abre, fecha)`) |
| `2026-10-19T22:00:00Z` | seg 19:00 | fechado (`isClosed`), `nextOpenAt` = ter 18:00 local |
| `2026-10-20T03:10:00Z` | ter 00:10 | **fechado** (segunda fechada, não há turno de ontem) |
| qualquer | — | override `'open'` → aberto; `'closed'` → fechado, `nextOpenAt null` |

Com o seed placeholder (18:00–23:30 todos os dias): sáb 23:29 aberto, 23:30 fechado.

Armadilhas: nunca `date.getDay()`/`getHours()` (fuso do processo); `hourCycle: 'h23'` evita `24:00` à meia-noite em alguns ICUs; o cálculo de `nextOpenAt` assume offset fixo na semana (válido para `America/Fortaleza`; revisar se `STORE_TIMEZONE` mudar para fuso com horário de verão).
