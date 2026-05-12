import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { RgrlMetadata } from '@/shared/templates/rgrl/schema';
import type { SupabaseClient } from '@supabase/supabase-js';

import { logger } from '@/shared/observability/logger';
import { rgrlMetadataSchema } from '@/shared/templates/rgrl/schema';

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

/**
 * T-021 · Fetcha el metadata RGRL parseado y validado para un informe.
 *
 * Devuelve null cuando:
 *  - No hay fila (informe pre-T-021 sin metadata, o tipo != rgrl, o RLS filtra).
 *  - La fila existe pero `data` no parsea contra `rgrlMetadataSchema`
 *    (schema drift post-T-022). Comportamiento defensivo: el caller renderiza
 *    el fallback "sin datos" en lugar de tirar.
 *
 * El error de DB se loguea pero tambien devuelve null — UX no debe bloquearse
 * por un fail transitorio del fetch de metadata.
 */
export async function getInformeMetadata(
  supabase: SupabaseClient<Database>,
  informeId: string,
): Promise<RgrlMetadata | null> {
  const { data, error } = await supabase
    .from('informe_metadata')
    .select('data')
    .eq('informe_id', informeId)
    .maybeSingle();

  if (error) {
    logger.error({ err: error, informeId }, 'getInformeMetadata: select fallo');
    return null;
  }
  if (!data?.data) return null;

  const parsed = rgrlMetadataSchema.safeParse(data.data);
  if (!parsed.success) {
    logger.warn(
      { informeId, issueCount: parsed.error.issues.length },
      'getInformeMetadata: schema drift, devolviendo null',
    );
    return null;
  }
  return parsed.data;
}
