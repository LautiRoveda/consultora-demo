import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * T-128 · Kernel compartido de validación cross-tenant + activo de un puesto.
 *
 * Devuelve `{ id, nombre }` solo si el puesto existe, pertenece al tenant del
 * caller (RLS filtra a null los de otra consultora) y NO está archivado. El
 * `nombre` se usa para la sincronía-puente (`empleados.puesto`).
 *
 * Reusado por `assignPuestoAction` (detalle, gestión M:N) y por las actions de
 * alta/edición de empleado (T-128) — una sola fuente para la regla "puesto
 * asignable", sin duplicar el SELECT defensivo.
 */
export async function resolveActivePuestoForTenant(
  supabase: SupabaseClient<Database>,
  puestoId: string,
): Promise<{ id: string; nombre: string } | null> {
  const { data } = await supabase
    .from('puestos')
    .select('id, nombre, archived_at')
    .eq('id', puestoId)
    .maybeSingle();
  if (!data || data.archived_at !== null) return null;
  return { id: data.id, nombre: data.nombre };
}
