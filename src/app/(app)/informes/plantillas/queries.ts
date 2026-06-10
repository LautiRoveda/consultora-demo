import type { InformeTipo } from '@/app/(app)/informes/schema';
import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * T-139 · Queries de plantillas de informes. RLS scopea al tenant del JWT —
 * sin filtro manual por consultora_id (mismo patron que clientes/queries.ts).
 */

export type PlantillaRow = Database['public']['Tables']['informe_plantillas']['Row'];

/**
 * Plantillas activas, opcionalmente de un tipo. Orden (tipo, nombre) — calza
 * con idx_informe_plantillas_lista. Sin paginacion: son presets de config,
 * el unique parcial por nombre acota el volumen real por tenant.
 */
export async function getPlantillasActivas(
  supabase: SupabaseClient<Database>,
  tipo?: InformeTipo,
): Promise<PlantillaRow[]> {
  let query = supabase
    .from('informe_plantillas')
    .select('*')
    .is('archived_at', null)
    .order('tipo', { ascending: true })
    .order('nombre', { ascending: true });

  if (tipo) {
    query = query.eq('tipo', tipo);
  }

  const { data } = await query;
  return data ?? [];
}
