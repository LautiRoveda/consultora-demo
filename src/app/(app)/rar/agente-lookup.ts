import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * T-143 · Kernel compartido de validación cross-tenant + activo de un agente de
 * riesgo.
 *
 * Devuelve `{ id, nombre }` solo si el agente existe, pertenece al tenant del
 * caller (RLS filtra a null los de otra consultora) y NO está archivado. Reusado
 * por `assignAgenteAPuestoAction` — una sola fuente para la regla "agente
 * asignable", molde de `resolveActivePuestoForTenant` (empleados/[id]/puestos).
 */
export async function resolveActiveAgenteForTenant(
  supabase: SupabaseClient<Database>,
  agenteId: string,
): Promise<{ id: string; nombre: string } | null> {
  const { data } = await supabase
    .from('rar_agentes')
    .select('id, nombre, archived_at')
    .eq('id', agenteId)
    .maybeSingle();
  if (!data || data.archived_at !== null) return null;
  return { id: data.id, nombre: data.nombre };
}
