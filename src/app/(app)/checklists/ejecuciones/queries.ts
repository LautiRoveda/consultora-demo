import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ItemForScore } from './scoring';

type Sb = SupabaseClient<Database>;

export type ChecklistExecutionRow = Database['public']['Tables']['checklist_executions']['Row'];
export type ChecklistExecutionVigenteRow =
  Database['public']['Views']['checklist_executions_vigentes']['Row'];
export type ExecutionRespuestaRow = Database['public']['Tables']['execution_respuestas']['Row'];
export type TemplateSectionRow = Database['public']['Tables']['template_sections']['Row'];
export type TemplateItemRow = Database['public']['Tables']['template_items']['Row'];

// Las queries reciben el `supabase` del request (RLS filtra por el claim JWT); NO
// reciben consultora_id. Las tablas de template exponen además filas de sistema.

/**
 * Última versión PUBLICADA de un template (sistema o del tenant). `null` si no
 * existe / no es visible / no tiene versión publicada.
 */
export async function getPublishedVersionId(sb: Sb, templateId: string): Promise<string | null> {
  const { data } = await sb
    .from('checklist_template_versions')
    .select('id')
    .eq('template_id', templateId)
    .eq('estado', 'published')
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export type EjecucionBasics = Pick<
  ChecklistExecutionRow,
  'id' | 'estado' | 'template_version_id' | 'consultora_id' | 'cliente_id' | 'fecha_inspeccion'
>;

/** Cabecera mínima de la ejecución (RLS-scoped). `null` = no existe / cross-tenant. */
export async function getEjecucionBasics(
  sb: Sb,
  executionId: string,
): Promise<EjecucionBasics | null> {
  const { data } = await sb
    .from('checklist_executions')
    .select('id, estado, template_version_id, consultora_id, cliente_id, fecha_inspeccion')
    .eq('id', executionId)
    .maybeSingle();
  return data ?? null;
}

export type ItemBasics = Pick<TemplateItemRow, 'id' | 'version_id' | 'response_type'>;

/** Tipo + versión de un ítem (para validar que la respuesta calza con el template). */
export async function getItemBasics(sb: Sb, itemId: string): Promise<ItemBasics | null> {
  const { data } = await sb
    .from('template_items')
    .select('id, version_id, response_type')
    .eq('id', itemId)
    .maybeSingle();
  return data ?? null;
}

/** ¿La respuesta pertenece a esta ejecución? (para atar un adjunto a un hallazgo). */
export async function respuestaBelongsToExecution(
  sb: Sb,
  respuestaId: string,
  executionId: string,
): Promise<boolean> {
  const { data } = await sb
    .from('execution_respuestas')
    .select('id')
    .eq('id', respuestaId)
    .eq('execution_id', executionId)
    .maybeSingle();
  return data != null;
}

export type AdjuntoForDelete = Pick<
  Database['public']['Tables']['execution_adjuntos']['Row'],
  'id' | 'execution_id' | 'storage_path' | 'consultora_id'
>;

export async function getAdjuntoForDelete(
  sb: Sb,
  adjuntoId: string,
): Promise<AdjuntoForDelete | null> {
  const { data } = await sb
    .from('execution_adjuntos')
    .select('id, execution_id, storage_path, consultora_id')
    .eq('id', adjuntoId)
    .maybeSingle();
  return data ?? null;
}

/** Ítems de una versión para scoring/completitud (ordenados, RLS-scoped). */
export async function getItemsForVersion(sb: Sb, versionId: string): Promise<ItemForScore[]> {
  const { data } = await sb
    .from('template_items')
    .select('id, response_type, es_critico, es_requerido, texto, orden')
    .eq('version_id', versionId)
    .order('orden', { ascending: true });
  return (data ?? []).map((i) => ({
    id: i.id,
    response_type: i.response_type,
    es_critico: i.es_critico,
    es_requerido: i.es_requerido,
    texto: i.texto,
  }));
}

export type RespuestaForClose = Pick<
  ExecutionRespuestaRow,
  'template_item_id' | 'valor' | 'valor_numerico' | 'observacion' | 'fecha_regularizacion'
>;

/** Respuestas de una ejecución (para score + CAPA + hash canónico). */
export async function getRespuestasForExecution(
  sb: Sb,
  executionId: string,
): Promise<RespuestaForClose[]> {
  const { data } = await sb
    .from('execution_respuestas')
    .select('template_item_id, valor, valor_numerico, observacion, fecha_regularizacion')
    .eq('execution_id', executionId);
  return data ?? [];
}

// ============================== Reads para la UI (T-061) ==============================

export type EjecucionSectionNode = TemplateSectionRow & { items: TemplateItemRow[] };

export type EjecucionForEdit = {
  execution: ChecklistExecutionRow;
  sections: EjecucionSectionNode[];
  respuestasByItemId: Record<string, ExecutionRespuestaRow>;
};

/**
 * Ejecución + estructura (sections/items de su versión) + respuestas indexadas
 * por item. Para la pantalla de relevamiento (T-061). `null` si no existe/RLS.
 */
export async function getEjecucionForEdit(
  sb: Sb,
  executionId: string,
): Promise<EjecucionForEdit | null> {
  const { data: execution } = await sb
    .from('checklist_executions')
    .select('*')
    .eq('id', executionId)
    .maybeSingle();
  if (!execution) return null;

  const [{ data: sections }, { data: items }, { data: respuestas }] = await Promise.all([
    sb
      .from('template_sections')
      .select('*')
      .eq('version_id', execution.template_version_id)
      .order('orden', { ascending: true }),
    sb
      .from('template_items')
      .select('*')
      .eq('version_id', execution.template_version_id)
      .order('orden', { ascending: true }),
    sb.from('execution_respuestas').select('*').eq('execution_id', executionId),
  ]);

  const itemsBySection = new Map<string, TemplateItemRow[]>();
  for (const item of items ?? []) {
    const arr = itemsBySection.get(item.section_id);
    if (arr) arr.push(item);
    else itemsBySection.set(item.section_id, [item]);
  }
  const sectionNodes: EjecucionSectionNode[] = (sections ?? []).map((s) => ({
    ...s,
    items: itemsBySection.get(s.id) ?? [],
  }));

  const respuestasByItemId: Record<string, ExecutionRespuestaRow> = {};
  for (const r of respuestas ?? []) respuestasByItemId[r.template_item_id] = r;

  return { execution, sections: sectionNodes, respuestasByItemId };
}

/** Listado de ejecuciones VIGENTES del tenant (head de cadena, no anuladas). */
export async function getEjecucionesForConsultora(sb: Sb): Promise<ChecklistExecutionVigenteRow[]> {
  const { data } = await sb
    .from('checklist_executions_vigentes')
    .select('*')
    .order('created_at', { ascending: false });
  return data ?? [];
}
