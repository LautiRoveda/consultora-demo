import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

const MAX_ASIGNADOS = 20;

export type PuestoAsignado = {
  puesto_id: string;
  asignado_at: string;
  nombre: string;
  descripcion: string | null;
  riesgos_asociados: string[] | null;
  archived_at: string | null;
};

export type PuestoDisponible = {
  id: string;
  nombre: string;
  descripcion: string | null;
};

/**
 * Lista los puestos asignados a un empleado. Incluye `archived_at` para que la
 * UI marque puestos descontinuados con badge "archivado" sin esconderlos
 * (decisión T-103: permitir limpieza manual de asignaciones huérfanas). RLS
 * filtra cross-tenant. Cap en 20 — empleado típico tiene 1-3 puestos.
 */
export async function listPuestosAsignados(
  supabase: SupabaseClient<Database>,
  empleadoId: string,
): Promise<PuestoAsignado[]> {
  const { data } = await supabase
    .from('empleados_puestos')
    .select(
      'puesto_id, asignado_at, puestos!inner(nombre, descripcion, riesgos_asociados, archived_at)',
    )
    .eq('empleado_id', empleadoId)
    .order('asignado_at', { ascending: false })
    .limit(MAX_ASIGNADOS);

  if (!data) return [];

  return data.map((row) => ({
    puesto_id: row.puesto_id,
    asignado_at: row.asignado_at,
    nombre: row.puestos.nombre,
    descripcion: row.puestos.descripcion,
    riesgos_asociados: row.puestos.riesgos_asociados,
    archived_at: row.puestos.archived_at,
  }));
}

/**
 * Lista puestos activos del catálogo del tenant que aún NO están asignados al
 * empleado. Usada por el Dialog de "Asignar puesto" para poblar el Select.
 * Implementación en 2 queries + diff in-JS (catálogo típico < 30 puestos —
 * mucho más simple que NOT IN anidado, costo despreciable).
 */
export async function listPuestosDisponiblesParaAsignar(
  supabase: SupabaseClient<Database>,
  empleadoId: string,
  consultoraId: string,
): Promise<PuestoDisponible[]> {
  const [catalogoRes, asignadosRes] = await Promise.all([
    supabase
      .from('puestos')
      .select('id, nombre, descripcion')
      .eq('consultora_id', consultoraId)
      .is('archived_at', null)
      .order('nombre', { ascending: true }),
    supabase.from('empleados_puestos').select('puesto_id').eq('empleado_id', empleadoId),
  ]);

  const catalogo = catalogoRes.data ?? [];
  const asignados = new Set((asignadosRes.data ?? []).map((r) => r.puesto_id));

  return catalogo
    .filter((p) => !asignados.has(p.id))
    .map((p) => ({ id: p.id, nombre: p.nombre, descripcion: p.descripcion }));
}
