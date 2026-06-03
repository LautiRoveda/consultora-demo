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
  gravedad?: IncidenteRow['gravedad'];
  clienteId?: string;
  empleadoId?: string;
  /** fecha >= desde (YYYY-MM-DD). */
  desde?: string;
  /** fecha <= hasta (YYYY-MM-DD). */
  hasta?: string;
  limit?: number;
  offset?: number;
  /**
   * T-063-FU2: si `true`, lee de `incidentes_heads` (head de cada cadena,
   * INCLUIDOS los anulados) en vez de `incidentes_vigentes`. La fila trae
   * `anulacion` para que la UI badgee los anulados.
   */
  includeAnulados?: boolean;
};

// Cap defensivo del walk-back de correcciones. No debería ciclar (append-only +
// UNIQUE corrige_id ⇒ cadena lineal finita), pero cortamos por las dudas.
const HISTORIAL_MAX = 50;

/**
 * Lista paginada de incidentes del tenant del JWT. Por default lee de
 * `incidentes_vigentes` (excluye anulados y versiones superseded); con
 * `includeAnulados` lee de `incidentes_heads` (head de cada cadena, anulados
 * incluidos). Ambas vistas son row-compatibles (`IncidenteVigente`).
 */
export async function getIncidentes(
  supabase: SupabaseClient<Database>,
  filters: GetIncidentesFilters = {},
): Promise<IncidenteVigente[]> {
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  const source = filters.includeAnulados ? 'incidentes_heads' : 'incidentes_vigentes';

  let query = supabase
    .from(source)
    .select('*')
    .order('fecha', { ascending: false })
    .order('id', { ascending: true });

  if (filters.tipo) query = query.eq('tipo', filters.tipo);
  if (filters.gravedad) query = query.eq('gravedad', filters.gravedad);
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
  /**
   * T-063: `true` si este registro es la cabeza vigente de su cadena —
   * NO está anulado Y ningún otro registro lo supersede vía `corrige_id`.
   * La UI sólo habilita Corregir/Anular sobre el registro vigente.
   */
  esVigente: boolean;
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

  // Vigencia DERIVADA (la tabla es append-only, sin flag mutable): vigente =
  // no anulado Y nadie lo supersede. Forward look RLS-scoped por `corrige_id`.
  let esVigente = false;
  if (!data.anulacion) {
    const { data: superseder } = await supabase
      .from('incidentes')
      .select('id')
      .eq('corrige_id', id)
      .maybeSingle();
    esVigente = !superseder;
  }

  return { incidente: data, historial, esVigente };
}

/**
 * T-063: empleados activos del tenant con su cliente, para el `Select` del form
 * de alta/corrección de incidentes. Mismo shape y cap (500) que
 * `listEmpleadosForEntregaWizard` (EPP). RLS filtra cross-tenant.
 */
export type IncidenteEmpleadoOption = {
  id: string;
  nombre: string;
  apellido: string;
  dni: string | null;
  cliente_id: string;
  cliente_razon_social: string;
};

export async function listEmpleadosForIncidenteForm(
  supabase: SupabaseClient<Database>,
): Promise<IncidenteEmpleadoOption[]> {
  const { data } = await supabase
    .from('empleados')
    .select('id, nombre, apellido, dni, cliente_id, cliente:clientes!inner(razon_social)')
    .is('archived_at', null)
    .order('apellido', { ascending: true })
    .order('nombre', { ascending: true })
    .limit(500);

  if (!data) return [];

  return data.map((row) => {
    const r = row as unknown as {
      id: string;
      nombre: string;
      apellido: string;
      dni: string | null;
      cliente_id: string;
      cliente: { razon_social: string } | null;
    };
    return {
      id: r.id,
      nombre: r.nombre,
      apellido: r.apellido,
      dni: r.dni,
      cliente_id: r.cliente_id,
      cliente_razon_social: r.cliente?.razon_social ?? '—',
    };
  });
}
