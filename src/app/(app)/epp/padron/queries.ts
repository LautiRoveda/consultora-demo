import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_LIMIT = 50;
const PENDIENTES_WINDOW_DAYS = 30;

export type PadronRow = {
  empleado_id: string;
  empleado_nombre: string;
  empleado_apellido: string;
  empleado_dni: string;
  cliente_id: string;
  cliente_razon_social: string;
  puestos_count: number;
  ultima_entrega: string | null;
  pendientes_proximos_count: number;
};

/**
 * T-106 · Lista empleados del tenant con su estado EPP agregado:
 *  - cantidad de puestos asignados (`empleados_puestos`),
 *  - fecha de la última entrega firmada (`epp_entregas`),
 *  - cantidad de planificaciones (T-102) cuyo `fecha_proxima_entrega` cae en
 *    los próximos `PENDIENTES_WINDOW_DAYS` días.
 *
 * RLS-aware. Cap 50 sin paginación (mismo pattern que `listEntregasByConsultora`).
 * El consultor MVP típico tiene 50-300 empleados; si emerge necesidad de
 * scroll/filtros más finos, T-106-FU1.
 *
 * Implementación: 4 queries paralelas + JOIN in-JS. No usamos Postgres views
 * porque añaden friction al schema y la agregación es barata (n < 500).
 */
export async function listEmpleadosConEstadoEpp(
  supabase: SupabaseClient<Database>,
  options: { clienteId?: string; limit?: number } = {},
): Promise<PadronRow[]> {
  const limit = options.limit ?? DEFAULT_LIMIT;

  // 1. Empleados activos del tenant (RLS scope).
  let empleadosQuery = supabase
    .from('empleados')
    .select('id, nombre, apellido, dni, cliente_id, cliente:clientes!inner(razon_social)')
    .is('archived_at', null)
    .order('apellido', { ascending: true })
    .order('nombre', { ascending: true })
    .limit(limit);
  if (options.clienteId) empleadosQuery = empleadosQuery.eq('cliente_id', options.clienteId);

  const { data: empleadosRaw } = await empleadosQuery;
  if (!empleadosRaw || empleadosRaw.length === 0) return [];

  type EmpleadoRow = {
    id: string;
    nombre: string;
    apellido: string;
    dni: string;
    cliente_id: string;
    cliente: { razon_social: string } | null;
  };
  const empleados = empleadosRaw as unknown as EmpleadoRow[];
  const empleadoIds = empleados.map((e) => e.id);

  // 2 + 3 + 4 paralelas — RLS-scoped, IN limitado por el cap del set anterior.
  const nowIso = new Date().toISOString().slice(0, 10);
  const windowDate = new Date();
  windowDate.setDate(windowDate.getDate() + PENDIENTES_WINDOW_DAYS);
  const windowIso = windowDate.toISOString().slice(0, 10);

  const [puestosRes, entregasRes, planiRes] = await Promise.all([
    supabase
      .from('empleados_puestos')
      .select('empleado_id, puesto_id')
      .in('empleado_id', empleadoIds),
    supabase
      .from('epp_entregas')
      .select('empleado_id, fecha_entrega')
      .in('empleado_id', empleadoIds)
      .not('firmado_at', 'is', null),
    supabase
      .from('epp_planificaciones')
      .select('empleado_id, fecha_proxima_entrega, estado')
      .in('empleado_id', empleadoIds)
      .eq('estado', 'activa')
      .gte('fecha_proxima_entrega', nowIso)
      .lte('fecha_proxima_entrega', windowIso),
  ]);

  // Agregación in-JS.
  const puestosByEmp = new Map<string, number>();
  for (const row of puestosRes.data ?? []) {
    puestosByEmp.set(row.empleado_id, (puestosByEmp.get(row.empleado_id) ?? 0) + 1);
  }

  const ultimaEntregaByEmp = new Map<string, string>();
  for (const row of entregasRes.data ?? []) {
    const existing = ultimaEntregaByEmp.get(row.empleado_id);
    if (!existing || row.fecha_entrega > existing) {
      ultimaEntregaByEmp.set(row.empleado_id, row.fecha_entrega);
    }
  }

  const pendientesByEmp = new Map<string, number>();
  for (const row of planiRes.data ?? []) {
    pendientesByEmp.set(row.empleado_id, (pendientesByEmp.get(row.empleado_id) ?? 0) + 1);
  }

  return empleados.map((e) => ({
    empleado_id: e.id,
    empleado_nombre: e.nombre,
    empleado_apellido: e.apellido,
    empleado_dni: e.dni,
    cliente_id: e.cliente_id,
    cliente_razon_social: e.cliente?.razon_social ?? '—',
    puestos_count: puestosByEmp.get(e.id) ?? 0,
    ultima_entrega: ultimaEntregaByEmp.get(e.id) ?? null,
    pendientes_proximos_count: pendientesByEmp.get(e.id) ?? 0,
  }));
}

/**
 * Lista clientes con al menos un empleado activo, para poblar el filtro de
 * cliente del padrón. RLS-scoped.
 */
export async function listClientesConEmpleados(
  supabase: SupabaseClient<Database>,
): Promise<Array<{ id: string; razon_social: string }>> {
  const { data } = await supabase
    .from('clientes')
    .select('id, razon_social, empleados!inner(id, archived_at)')
    .is('empleados.archived_at', null)
    .order('razon_social', { ascending: true });

  if (!data) return [];
  const seen = new Set<string>();
  const out: Array<{ id: string; razon_social: string }> = [];
  for (const row of data) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push({ id: row.id, razon_social: row.razon_social });
  }
  return out;
}
