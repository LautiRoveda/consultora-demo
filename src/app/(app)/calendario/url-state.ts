import type { CalendarEventStatus, CalendarEventTipo } from './defaults';

import { EVENT_STATUS_VALUES, EVENT_TIPO_VALUES } from './defaults';

/**
 * T-029 · Parser/builder de searchParams del calendario.
 *
 * Archivo puro (sin `'use server'`, sin imports React/Next) → testeable solo y
 * reusable desde server (`page.tsx` parsea) y client (`CalendarView` empuja
 * cambios via `router.replace`).
 *
 * Contrato URL:
 *   ?month=YYYY-MM         (default: mes actual UTC)
 *   ?tipo=a,b,c            (subset de EVENT_TIPO_VALUES, default: vacio = todos)
 *   ?status=a,b            (subset de EVENT_STATUS_VALUES, default: ['pending'])
 *   ?event=<uuid>          (si presente, drawer abre en mode 'view')
 *
 * Defensivo: cualquier valor invalido cae al default + log silent. NO tira.
 */

export type UrlState = {
  /** Año UTC. */
  year: number;
  /** Mes 1..12 (NO 0..11 como Date.getMonth()). */
  month: number;
  tipo: CalendarEventTipo[];
  status: CalendarEventStatus[];
  event: string | null;
};

export const DEFAULT_STATUS: readonly CalendarEventStatus[] = ['pending'];

const MONTH_REGEX = /^(\d{4})-(0[1-9]|1[0-2])$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Acepta el shape que devuelve Next 16 page.tsx (`{[k]: string|string[]|undefined}`)
 * o un `URLSearchParams` real (cliente). Normalizamos internamente.
 */
type SearchParamsInput =
  | URLSearchParams
  | Record<string, string | string[] | undefined>
  | null
  | undefined;

function readParam(input: SearchParamsInput, key: string): string | null {
  if (!input) return null;
  if (input instanceof URLSearchParams) {
    return input.get(key);
  }
  const raw = input[key];
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw ?? null;
}

function todayYearMonthUtc(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

export function parseUrlState(input: SearchParamsInput): UrlState {
  // month
  let year: number;
  let month: number;
  const monthRaw = readParam(input, 'month');
  const matched = monthRaw ? MONTH_REGEX.exec(monthRaw) : null;
  if (matched) {
    year = Number(matched[1]);
    month = Number(matched[2]);
  } else {
    const fallback = todayYearMonthUtc();
    year = fallback.year;
    month = fallback.month;
  }

  // tipo (intersect con EVENT_TIPO_VALUES, dedup)
  const tipoRaw = readParam(input, 'tipo');
  const tipo = tipoRaw
    ? Array.from(
        new Set(
          tipoRaw
            .split(',')
            .map((v) => v.trim())
            .filter((v): v is CalendarEventTipo =>
              (EVENT_TIPO_VALUES as readonly string[]).includes(v),
            ),
        ),
      )
    : [];

  // status (intersect, dedup; default a DEFAULT_STATUS si vacio o ausente)
  const statusRaw = readParam(input, 'status');
  let status: CalendarEventStatus[];
  if (statusRaw === null) {
    status = [...DEFAULT_STATUS];
  } else {
    status = Array.from(
      new Set(
        statusRaw
          .split(',')
          .map((v) => v.trim())
          .filter((v): v is CalendarEventStatus =>
            (EVENT_STATUS_VALUES as readonly string[]).includes(v),
          ),
      ),
    );
    if (status.length === 0) status = [...DEFAULT_STATUS];
  }

  // event (UUID v4-ish, lax pero suficiente para descartar input crudo)
  const eventRaw = readParam(input, 'event');
  const event = eventRaw && UUID_REGEX.test(eventRaw) ? eventRaw : null;

  return { year, month, tipo, status, event };
}

/**
 * Serializa un partial state a query string. NO emite keys cuyo valor matchea
 * el default — la URL queda canonica/corta.
 *
 * Pasar `undefined` en una key fuerza removerla. Pasar una key con valor
 * default tambien la remueve.
 */
export function buildSearchParams(state: Partial<UrlState>): string {
  const sp = new URLSearchParams();

  if (state.year !== undefined && state.month !== undefined) {
    const today = todayYearMonthUtc();
    if (state.year !== today.year || state.month !== today.month) {
      sp.set('month', formatYM({ year: state.year, month: state.month }));
    }
  }

  if (state.tipo !== undefined && state.tipo.length > 0) {
    sp.set('tipo', state.tipo.join(','));
  }

  if (state.status !== undefined) {
    const isDefault =
      state.status.length === DEFAULT_STATUS.length &&
      state.status.every((s, i) => s === DEFAULT_STATUS[i]);
    if (!isDefault && state.status.length > 0) {
      sp.set('status', state.status.join(','));
    }
  }

  if (state.event !== undefined && state.event !== null) {
    sp.set('event', state.event);
  }

  return sp.toString();
}

export function formatYM(d: { year: number; month: number }): string {
  return `${d.year}-${String(d.month).padStart(2, '0')}`;
}

export function addMonthsToYM(
  d: { year: number; month: number },
  delta: number,
): { year: number; month: number } {
  // month es 1..12. Convertimos a 0-indexed para aritmetica modular limpia.
  const totalMonths = d.year * 12 + (d.month - 1) + delta;
  const year = Math.floor(totalMonths / 12);
  const month = (totalMonths % 12) + 1;
  return { year, month };
}

/**
 * Devuelve `[fromIso, toIso]` (YYYY-MM-DD) cubriendo todo el mes especificado.
 * Usado por `getCalendarEventsForConsultora({ fechaFrom, fechaTo })` en page.tsx.
 */
export function monthBoundsIso(year: number, month: number): [string, string] {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  // Ultimo dia del mes: dia 0 del mes siguiente en UTC.
  const lastDate = new Date(Date.UTC(year, month, 0));
  const to = `${lastDate.getUTCFullYear()}-${String(lastDate.getUTCMonth() + 1).padStart(2, '0')}-${String(lastDate.getUTCDate()).padStart(2, '0')}`;
  return [from, to];
}
