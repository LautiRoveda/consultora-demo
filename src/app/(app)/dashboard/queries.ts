import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CalendarEventRow } from '../calendario/queries';
import type { InformeListRow } from '../informes/queries';

import { groupEventsByBucket } from '../calendario/agenda-buckets';
import { getOverdueEvents, getUpcomingEvents } from '../calendario/queries';
import { countCapasAbiertas } from '../checklists/ejecuciones/queries';
import { countInformesEnBorrador, listInformes } from '../informes/queries';

/**
 * T-131 · Agregador de datos del dashboard operativo (fase A).
 *
 * Un único `Promise.all` (sin waterfall) que alimenta TODO el tablero: la banda
 * de contadores, la cola "Lo que necesita tu atención" y la columna derecha.
 * Lo consume el server component `DashboardData` detrás de un `<Suspense>` para
 * streamear el shell del page al instante.
 *
 * RLS scopea el tenant — no recibimos `consultora_id`.
 */

export type DashboardMetrics = {
  /** Vencimientos en [hoy, hoy+7]. Excluye los ya vencidos (contador aparte). */
  vencenSemana: number;
  /** Vencimientos con fecha < hoy. */
  vencidos: number;
  /** Informes en estado 'draft' (exacto, no capado a 50). */
  borradores: number;
  /** CAPAs en estado abierta/en_progreso (exacto, no capado a 50). */
  accionesAbiertas: number;
};

export type AttentionEntry = {
  ev: CalendarEventRow;
  severity: 'overdue' | 'upcoming';
};

export type DashboardData = {
  metrics: DashboardMetrics;
  /** Cola priorizada: vencidos (más viejo primero) y luego por vencer. */
  attention: AttentionEntry[];
  /** 1-2 borradores recientes para "Seguir con lo tuyo". */
  recentDrafts: InformeListRow[];
};

/** Máximo de ítems en la cola de atención del home (el resto vive en /calendario/agenda). */
const ATTENTION_LIMIT = 6;
/** Cantidad de borradores recientes en "Seguir con lo tuyo". */
const RECENT_DRAFTS_LIMIT = 2;

export async function getDashboardData(supabase: SupabaseClient<Database>): Promise<DashboardData> {
  const [overdue, upcoming, informes, borradores, accionesAbiertas] = await Promise.all([
    getOverdueEvents(supabase),
    getUpcomingEvents(supabase, 30),
    listInformes(supabase),
    countInformesEnBorrador(supabase),
    countCapasAbiertas(supabase),
  ]);

  // Bucketea SOLO upcoming (fecha >= hoy) → "vencen esta semana" no se solapa
  // con el contador de "vencidos". `hoy` = vence hoy; `siete` = +1..+7.
  const buckets = groupEventsByBucket(upcoming, new Date());
  const vencenSemana = buckets.hoy.length + buckets.siete.length;

  // Prioridad: vencidos (ASC = más viejo primero, ya ordenado por la query) y
  // luego por vencer (ASC). Top-N para el home.
  const attention: AttentionEntry[] = [
    ...overdue.map((ev): AttentionEntry => ({ ev, severity: 'overdue' })),
    ...upcoming.map((ev): AttentionEntry => ({ ev, severity: 'upcoming' })),
  ].slice(0, ATTENTION_LIMIT);

  const recentDrafts = informes.filter((i) => i.status === 'draft').slice(0, RECENT_DRAFTS_LIMIT);

  return {
    metrics: { vencenSemana, vencidos: overdue.length, borradores, accionesAbiertas },
    attention,
    recentDrafts,
  };
}
