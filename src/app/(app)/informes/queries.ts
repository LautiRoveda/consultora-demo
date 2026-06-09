import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

import { logger } from '@/shared/observability/logger';
import { getServerTemplate } from '@/shared/templates/registry/server';

import { type InformeTipo } from './schema';

/**
 * T-019 · Queries server-only del modulo Informes.
 * T-021 · `getInformeMetadata` para RGRL.
 * T-022 · `getInformeMetadata` se generaliza: dispatch por `tipo` al registry,
 * return type discriminado `{ tipo, data } | null`.
 *
 * Helpers que invocan Server Components (page.tsx). NO son Server Actions
 * (no llevan `'use server'`) — son funciones puras que reciben el client ya
 * creado por el caller.
 *
 * RLS hace el scoping por consultora — no pasamos `consultora_id` a proposito.
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

/**
 * T-131 · Conteo exacto de informes en borrador para el contador del dashboard.
 *
 * `head: true` no trae filas (solo el count); RLS scopea el tenant. El filtro
 * `status='draft'` espeja el subset que el dashboard lista como "Seguir con lo
 * tuyo" (`listInformes` filtrado a `draft`) → contador y lista no se contradicen.
 * No usamos `listInformes().length` porque está cap a 50 y subcontaría.
 */
export async function countInformesEnBorrador(supabase: SupabaseClient<Database>): Promise<number> {
  const { count, error } = await supabase
    .from('informes')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'draft');

  if (error) {
    logger.error({ err: error }, 'countInformesEnBorrador: count fallo');
    return 0;
  }
  return count ?? 0;
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
 * T-022 · Tagged union retornado por `getInformeMetadata`. Permite al consumer
 * narrowear por tipo y acceder a `data` con el shape correcto.
 *
 * `data` es `unknown` en la API publica — el consumer DEBE re-parsear con el
 * schema correcto cuando lo necesite typesafe. En la practica los consumers
 * narrowean por tipo y pasan `data` directo a un Summary component que lo
 * recibe ya typed (porque el page.tsx ya verifico `tipo`).
 */
export type InformeMetadataRow = {
  tipo: InformeTipo;
  data: unknown;
};

/**
 * T-022 · Fetcha la metadata parseada y validada para un informe dado su tipo.
 *
 * Dispatch por tipo via `getServerTemplate(tipo)`. Si el tipo no tiene
 * template registrado, devuelve null sin tocar DB.
 *
 * Devuelve null cuando:
 *  - El tipo no tiene template (defensa forward).
 *  - No hay fila (informe pre-T-021/T-022 sin metadata, o RLS filtra).
 *  - La fila existe pero `data` no parsea contra el schema del tipo
 *    (schema drift). Comportamiento defensivo: el caller renderiza el
 *    fallback "sin datos" en lugar de tirar.
 *
 * El error de DB se loguea pero tambien devuelve null — UX no debe bloquearse
 * por un fail transitorio del fetch de metadata.
 */
export async function getInformeMetadata(
  supabase: SupabaseClient<Database>,
  informeId: string,
  tipo: InformeTipo,
): Promise<InformeMetadataRow | null> {
  const tipoEntry = getServerTemplate(tipo);
  if (!tipoEntry) return null;

  const { data, error } = await supabase
    .from('informe_metadata')
    .select('data')
    .eq('informe_id', informeId)
    .maybeSingle();

  if (error) {
    logger.error({ err: error, informeId, tipo }, 'getInformeMetadata: select fallo');
    return null;
  }
  if (!data?.data) return null;

  const parsed = tipoEntry.schema.safeParse(data.data);
  if (!parsed.success) {
    logger.warn(
      { informeId, tipo, issueCount: parsed.error.issues.length },
      'getInformeMetadata: schema drift, devolviendo null',
    );
    return null;
  }
  return { tipo, data: parsed.data };
}
