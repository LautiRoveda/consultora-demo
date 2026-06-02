import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * T-062 · Capa de lectura del libro de incidentes.
 *
 * RLS de `incidentes` filtra cross-tenant automáticamente. NO recibimos
 * `consultora_id` como param — la fuente de verdad es el claim del JWT.
 */

export type IncidenteRow = Database['public']['Tables']['incidentes']['Row'];

/**
 * Shape de la vista `incidentes_vigentes` (head de cada cadena de correcciones).
 * Columnas nullable porque el generador de tipos no prueba NOT NULL en vistas;
 * en la práctica reflejan la fila vigente subyacente.
 */
export type IncidenteVigente = Database['public']['Views']['incidentes_vigentes']['Row'];

export type GetIncidentesFilters = {
  tipo?: IncidenteRow['tipo'];
  clienteId?: string;
  empleadoId?: string;
  /** fecha >= desde (YYYY-MM-DD). */
  desde?: string;
  /** fecha <= hasta (YYYY-MM-DD). */
  hasta?: string;
  limit?: number;
  offset?: number;
};

// Cap defensivo del walk-back de correcciones. No debería ciclar (append-only +
// UNIQUE corrige_id ⇒ cadena lineal finita), pero cortamos por las dudas.
const HISTORIAL_MAX = 50;

/**
 * Lista paginada de incidentes VIGENTES del tenant del JWT (lee de la vista
 * `incidentes_vigentes`: excluye anulados y versiones superseded).
 */
export async function getIncidentes(
  supabase: SupabaseClient<Database>,
  filters: GetIncidentesFilters = {},
): Promise<IncidenteVigente[]> {
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  let query = supabase
    .from('incidentes_vigentes')
    .select('*')
    .order('fecha', { ascending: false })
    .order('id', { ascending: true });

  if (filters.tipo) query = query.eq('tipo', filters.tipo);
  if (filters.clienteId) query = query.eq('cliente_id', filters.clienteId);
  if (filters.empleadoId) query = query.eq('empleado_id', filters.empleadoId);
  if (filters.desde) query = query.gte('fecha', filters.desde);
  if (filters.hasta) query = query.lte('fecha', filters.hasta);

  query = query.range(offset, offset + limit - 1);

  const { data } = await query;
  return data ?? [];
}

export type IncidenteConHistorial = {
  /** El registro pedido (puede o no ser el vigente de su cadena). */
  incidente: IncidenteRow;
  /** Versiones anteriores siguiendo `corrige_id` (más nueva → más vieja). */
  historial: IncidenteRow[];
};

/**
 * Un incidente por id + su historial de correcciones (walk hacia atrás por
 * `corrige_id`). RLS filtra cross-tenant. `null` si no existe / no es del tenant.
 */
export async function getIncidenteById(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<IncidenteConHistorial | null> {
  const { data } = await supabase.from('incidentes').select('*').eq('id', id).maybeSingle();
  if (!data) return null;

  const historial: IncidenteRow[] = [];
  let cursor = data.corrige_id;
  let guard = 0;
  while (cursor && guard < HISTORIAL_MAX) {
    const { data: prev } = await supabase
      .from('incidentes')
      .select('*')
      .eq('id', cursor)
      .maybeSingle();
    if (!prev) break;
    historial.push(prev);
    cursor = prev.corrige_id;
    guard += 1;
  }

  return { incidente: data, historial };
}
