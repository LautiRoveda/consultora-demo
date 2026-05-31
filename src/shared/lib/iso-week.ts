import { todayCivilIsoAR } from './format-date';

/**
 * T-109 · ID de semana ISO 8601 ('2026-W22') del dia civil ART de `now`.
 *
 * Clave de idempotencia (`periodo_iso`) del digest semanal EPP: una fila por
 * (consultora, tipo, semana, canal) en notification_digest_log.
 *
 * Base en dia civil ART (todayCivilIsoAR), NO en UTC -> inmune al runtime TZ
 * del container. El ano ISO es el ano del JUEVES de la semana (no el calendario
 * del lunes): eso cubre el borde 53/01 sin casos especiales (ej. 2021-01-01,
 * viernes, pertenece a 2020-W53).
 */
export function isoWeekId(now: Date = new Date()): string {
  const [y, m, d] = todayCivilIsoAR(now).split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  // Lunes=0 ... domingo=6. Avanzamos al jueves de esta semana ISO.
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const isoYear = date.getUTCFullYear();
  // 4-ene siempre pertenece a la semana 1 (definicion ISO 8601).
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const ftDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ftDayNum + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}
