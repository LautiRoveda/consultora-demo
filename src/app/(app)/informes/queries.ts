import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

import { logger } from '@/shared/observability/logger';

/**
 * T-019 · Queries server-only del modulo Informes.
 *
 * Helpers que invocan Server Components (page.tsx). NO son Server Actions
 * (no llevan `'use server'`) — son funciones puras que reciben el client ya
 * creado por el caller. Esto permite testear sin Next runtime y reutilizar el
 * client entre multiples queries de la misma request.
 *
 * RLS hace el scoping por consultora — no pasamos `consultora_id` a propósito.
 * El JWT del request limita lo que `select` puede ver.
 */

type Informe = Database['public']['Tables']['informes']['Row'];
export type InformeListRow = Pick<Informe, 'id' | 'tipo' | 'titulo' | 'status' | 'created_at'>;

export async function listInformes(supabase: SupabaseClient<Database>): Promise<InformeListRow[]> {
  const { data, error } = await supabase
    .from('informes')
    .select('id, tipo, titulo, status, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    logger.error({ err: error }, 'listInformes: select fallo');
    return [];
  }
  return data ?? [];
}

export async function getInformeById(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<Informe | null> {
  const { data, error } = await supabase.from('informes').select('*').eq('id', id).maybeSingle();

  if (error) {
    logger.error({ err: error, id }, 'getInformeById: select fallo');
    return null;
  }
  return data;
}
