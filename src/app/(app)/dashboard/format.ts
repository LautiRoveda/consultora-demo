import type { CalendarEventRow } from '../calendario/queries';

import { formatCivilDateShortAR, todayCivilIsoAR } from '@/shared/lib/format-date';

/**
 * T-131 · Helpers de formato del dashboard.
 *
 * Sin `'use server'` / `'server-only'`: módulo puro y testeable (igual que
 * `calendario/agenda-buckets.ts`). `formatEventDate` + `civilDayDiff` se movieron
 * verbatim desde el viejo `ProximosVencimientosPanel` (T-030) — preservan la
 * comparación civil-day en TZ AR de T-085 (NO reimplementar con `new Date()` UTC).
 */

/** Texto relativo del vencimiento ("Vence hoy", "Venció hace 3 días", fecha). */
export function formatEventDate(ev: Pick<CalendarEventRow, 'fecha_vencimiento'>): string {
  // Comparación civil string-vs-string: ambos YYYY-MM-DD. Evita roundtrip a
  // Date que dependería del runtime TZ.
  const today = todayCivilIsoAR();
  const diffDays = civilDayDiff(today, ev.fecha_vencimiento);
  if (diffDays < 0) {
    const abs = Math.abs(diffDays);
    return `Venció hace ${abs} ${abs === 1 ? 'día' : 'días'}`;
  }
  if (diffDays === 0) return 'Vence hoy';
  if (diffDays === 1) return 'Vence mañana';
  if (diffDays <= 7) return `Vence en ${diffDays} días`;
  return formatCivilDateShortAR(ev.fecha_vencimiento);
}

export function civilDayDiff(fromCivilIso: string, toCivilIso: string): number {
  const [fy, fm, fd] = fromCivilIso.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = toCivilIso.split('-').map(Number) as [number, number, number];
  const fromUtc = Date.UTC(fy, fm - 1, fd);
  const toUtc = Date.UTC(ty, tm - 1, td);
  return Math.round((toUtc - fromUtc) / 86_400_000);
}

/**
 * Línea de "pulso" debajo del saludo. Resume lo accionable de hoy en lenguaje
 * del dominio, con pluralización ES. Si no hay nada pendiente → mensaje positivo.
 */
export function buildPulseLine(m: {
  vencidos: number;
  vencenSemana: number;
  borradores: number;
}): string {
  const parts: string[] = [];
  if (m.vencidos > 0) {
    parts.push(`${m.vencidos} ${m.vencidos === 1 ? 'vencido' : 'vencidos'}`);
  }
  if (m.vencenSemana > 0) {
    parts.push(`${m.vencenSemana} ${m.vencenSemana === 1 ? 'vence' : 'vencen'} esta semana`);
  }
  if (m.borradores > 0) {
    parts.push(`${m.borradores} ${m.borradores === 1 ? 'informe a medias' : 'informes a medias'}`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'Todo al día, sin pendientes inmediatos.';
}
