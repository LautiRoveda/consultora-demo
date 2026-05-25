/**
 * T-085 · Helper centralizado de formateo de fechas en TZ Argentina.
 *
 * Política: storage en `timestamptz` UTC, display siempre en
 * America/Argentina/Buenos_Aires. La TZ se hardcodea en cada call a
 * `Intl.DateTimeFormat` → inmune al runtime TZ (UTC del container, local del
 * browser). Ver docs/technical/08-timezone.md.
 *
 * Dos familias separadas por tipo de fecha en BD:
 *  - Timestamps UTC (`timestamptz`: created_at, firmado_at, completed_at...):
 *    funciones `format*AR(input: string | Date)`. Convierten a TZ AR.
 *  - Civil dates (`date`: calendar_events.fecha_vencimiento, empleados.fecha_ingreso):
 *    funciones `formatCivil*AR(civilIso: string)`. Tratan el string como
 *    literal — sin conversión TZ, sin off-by-one.
 *
 * Sin dependencias nuevas. Intl nativo alcanza.
 */

export const AR_TIMEZONE = 'America/Argentina/Buenos_Aires';
export const AR_LOCALE = 'es-AR';

type DateInput = string | Date;

function toDate(input: DateInput): Date {
  return input instanceof Date ? input : new Date(input);
}

/**
 * Construye un `Date` que representa mediodía AR del día civil dado. La hora
 * 12:00 AR (= 15:00 UTC) está lejos de cualquier cruce de día, así que cuando
 * `Intl.DateTimeFormat` aplica `timeZone: AR_TIMEZONE` el día/mes/año
 * extraídos son idempotentes al runtime TZ.
 */
function civilIsoToArNoonDate(civilIso: string): Date {
  const [y, m, d] = civilIso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 15, 0, 0));
}

// ════════════════════════════════════════════════════════════════════════════
// Timestamps UTC → display TZ AR
// ════════════════════════════════════════════════════════════════════════════

const dateArFormatter = new Intl.DateTimeFormat(AR_LOCALE, {
  timeZone: AR_TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const dateTimeArFormatter = new Intl.DateTimeFormat(AR_LOCALE, {
  timeZone: AR_TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const dateLongArFormatter = new Intl.DateTimeFormat(AR_LOCALE, {
  timeZone: AR_TIMEZONE,
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const dateLongWithWeekdayArFormatter = new Intl.DateTimeFormat(AR_LOCALE, {
  timeZone: AR_TIMEZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const relativeArFormatter = new Intl.RelativeTimeFormat(AR_LOCALE, { numeric: 'auto' });

/** `"25/05/2026"` desde timestamptz UTC (Date o ISO string). */
export function formatDateAR(input: DateInput): string {
  return dateArFormatter.format(toDate(input));
}

/** `"25/05/2026 14:30"` desde timestamptz UTC. */
export function formatDateTimeAR(input: DateInput): string {
  // es-AR `dateStyle: 'short'` + `timeStyle: 'short'` agrega ", " entre fecha
  // y hora. Acá usamos parts para forzar `" "` (espacio simple) y mantener
  // backwards-compat con los call sites que escriben `"DD/MM/YYYY HH:mm"`.
  const parts = dateTimeArFormatter.formatToParts(toDate(input));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

/** `"25 de mayo de 2026"` desde timestamptz UTC. */
export function formatDateLongAR(input: DateInput): string {
  return dateLongArFormatter.format(toDate(input));
}

/** `"lunes, 25 de mayo de 2026"` (con coma post-weekday) desde timestamptz UTC. */
export function formatDateLongWithWeekdayAR(input: DateInput): string {
  return dateLongWithWeekdayArFormatter.format(toDate(input));
}

/**
 * `"hace 3 días"` / `"en 2 horas"` — usa Intl.RelativeTimeFormat.
 * Granularity automática: segundos < minuto < hora < día < mes < año.
 */
export function formatRelativeAR(input: DateInput, now: Date = new Date()): string {
  const diffMs = toDate(input).getTime() - now.getTime();
  const absMs = Math.abs(diffMs);
  const sec = diffMs / 1000;
  const min = sec / 60;
  const hr = min / 60;
  const day = hr / 24;
  const month = day / 30;
  const year = day / 365;

  if (absMs < 60_000) return relativeArFormatter.format(Math.round(sec), 'second');
  if (absMs < 3_600_000) return relativeArFormatter.format(Math.round(min), 'minute');
  if (absMs < 86_400_000) return relativeArFormatter.format(Math.round(hr), 'hour');
  if (absMs < 2_592_000_000) return relativeArFormatter.format(Math.round(day), 'day');
  if (absMs < 31_536_000_000) return relativeArFormatter.format(Math.round(month), 'month');
  return relativeArFormatter.format(Math.round(year), 'year');
}

// ════════════════════════════════════════════════════════════════════════════
// Civil dates YYYY-MM-DD → display literal (sin TZ conversion)
// ════════════════════════════════════════════════════════════════════════════

/** `"25/05/2026"` desde `YYYY-MM-DD` civil (campo Postgres `date`). */
export function formatCivilDateAR(civilIso: string): string {
  return dateArFormatter.format(civilIsoToArNoonDate(civilIso));
}

/** `"25 de mayo de 2026"` desde `YYYY-MM-DD` civil. */
export function formatCivilDateLongAR(civilIso: string): string {
  return dateLongArFormatter.format(civilIsoToArNoonDate(civilIso));
}

/** `"lunes, 25 de mayo de 2026"` (con coma post-weekday) desde `YYYY-MM-DD` civil. */
export function formatCivilDateLongWithWeekdayAR(civilIso: string): string {
  return dateLongWithWeekdayArFormatter.format(civilIsoToArNoonDate(civilIso));
}

const civilDateShortArFormatter = new Intl.DateTimeFormat(AR_LOCALE, {
  timeZone: AR_TIMEZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** `"25 de may de 2026"` (mes abreviado) desde `YYYY-MM-DD` civil. */
export function formatCivilDateShortAR(civilIso: string): string {
  return civilDateShortArFormatter.format(civilIsoToArNoonDate(civilIso));
}

// ════════════════════════════════════════════════════════════════════════════
// "Hoy" AR
// ════════════════════════════════════════════════════════════════════════════

/**
 * Devuelve el día calendario AR como `YYYY-MM-DD`, independiente del runtime
 * TZ. Reemplaza patrones como `new Date().toISOString().slice(0, 10)` (que da
 * el día UTC, no AR) o `dateToCivilIso(new Date())` (que da el día local del
 * browser/server).
 */
export function todayCivilIsoAR(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: AR_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
