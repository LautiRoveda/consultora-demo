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

export type CapaBasics = Pick<
  Database['public']['Tables']['acciones_correctivas']['Row'],
  'id' | 'estado' | 'calendar_event_id' | 'execution_id'
>;

/**
 * Cabecera mínima de una acción correctiva (RLS-scoped). `null` = no existe /
 * cross-tenant. `execution_id` se usa para revalidar la ficha al resolverla (T-120).
 */
export async function getCapaBasics(sb: Sb, capaId: string): Promise<CapaBasics | null> {
  const { data } = await sb
    .from('acciones_correctivas')
    .select('id, estado, calendar_event_id, execution_id')
    .eq('id', capaId)
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
  'id' | 'template_item_id' | 'valor' | 'valor_numerico' | 'observacion' | 'fecha_regularizacion'
>;

/** Respuestas de una ejecución (para score + CAPA + hash canónico). `id` = respuesta_id de la CAPA. */
export async function getRespuestasForExecution(
  sb: Sb,
  executionId: string,
): Promise<RespuestaForClose[]> {
  const { data } = await sb
    .from('execution_respuestas')
    .select('id, template_item_id, valor, valor_numerico, observacion, fecha_regularizacion')
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

export type GetEjecucionesOptions = {
  /**
   * T-061-FU1: si `true`, lee de `checklist_executions_heads` (head de cada cadena,
   * INCLUIDAS las anuladas/tombstones) en vez de `checklist_executions_vigentes`.
   * Ambas vistas son row-compatibles → un solo tipo de retorno. La fila trae
   * `estado` ('anulada' en los tombstones) para que la UI badgee los anulados.
   */
  includeAnuladas?: boolean;
};

/**
 * Listado de ejecuciones del tenant. Por default lee de
 * `checklist_executions_vigentes` (head no anulada); con `includeAnuladas` lee de
 * `checklist_executions_heads` (head de cada cadena, anuladas incluidas). RLS
 * filtra cross-tenant. Mismo patrón que `getIncidentes` (T-063-FU2).
 */
export async function getEjecucionesForConsultora(
  sb: Sb,
  opts: GetEjecucionesOptions = {},
): Promise<ChecklistExecutionVigenteRow[]> {
  const source = opts.includeAnuladas
    ? 'checklist_executions_heads'
    : 'checklist_executions_vigentes';
  const { data } = await sb.from(source).select('*').order('created_at', { ascending: false });
  return data ?? [];
}

// ============================== Read para el PDF (T-060b) ==============================

export type EjecucionAdjunto = Pick<
  Database['public']['Tables']['execution_adjuntos']['Row'],
  'id' | 'respuesta_id' | 'storage_path' | 'mime_type'
>;
export type EjecucionFirma = Pick<
  Database['public']['Tables']['execution_firmas']['Row'],
  'rol' | 'firma_storage_path' | 'firmante_nombre' | 'firmante_matricula' | 'firmado_at'
>;

export type EjecucionForPdf = {
  execution: ChecklistExecutionRow;
  sections: EjecucionSectionNode[];
  respuestasByItemId: Record<string, ExecutionRespuestaRow>;
  adjuntos: EjecucionAdjunto[];
  firmaMatriculado: EjecucionFirma | null;
};

/**
 * Datos completos de una ejecución para el PDF RGRL: cabecera + estructura +
 * respuestas + adjuntos + firma del matriculado. `null` si no existe/RLS. El
 * page del print genera las signed URLs (firma/adjuntos/logo) sobre este shape.
 */
export async function getEjecucionForPdf(
  sb: Sb,
  executionId: string,
): Promise<EjecucionForPdf | null> {
  const { data: execution } = await sb
    .from('checklist_executions')
    .select('*')
    .eq('id', executionId)
    .maybeSingle();
  if (!execution) return null;

  const [
    { data: sections },
    { data: items },
    { data: respuestas },
    { data: adjuntos },
    { data: firma },
  ] = await Promise.all([
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
    sb
      .from('execution_adjuntos')
      .select('id, respuesta_id, storage_path, mime_type')
      .eq('execution_id', executionId)
      .order('created_at', { ascending: true }),
    sb
      .from('execution_firmas')
      .select('rol, firma_storage_path, firmante_nombre, firmante_matricula, firmado_at')
      .eq('execution_id', executionId)
      .eq('rol', 'matriculado')
      .maybeSingle(),
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

  return {
    execution,
    sections: sectionNodes,
    respuestasByItemId,
    adjuntos: adjuntos ?? [],
    firmaMatriculado: firma ?? null,
  };
}

// ============================== Read para el detalle (T-061b) ==============================

export type CapaForDetail = {
  id: string;
  descripcion: string;
  prioridad: string;
  estado: string;
  /** YYYY-MM-DD. */
  fecha_compromiso: string;
  calendar_event_id: string | null;
  /** YYYY-MM-DD del evento de calendario (para el `?month=` del deep-link). null si no hay evento. */
  calendar_event_fecha_vencimiento: string | null;
};

/**
 * CAPAs (acciones_correctivas) de una ejecución para el detalle, con la fecha del
 * evento de calendario asociado (para deep-linkear a /calendario?event=&month=).
 * Dos pasos (no embed PostgREST): trae las CAPAs y, si alguna tiene
 * calendar_event_id, resuelve las fechas en un solo IN(...) (RLS-scoped igual).
 */
export async function getAccionesForExecution(
  sb: Sb,
  executionId: string,
): Promise<CapaForDetail[]> {
  const { data: acciones } = await sb
    .from('acciones_correctivas')
    .select('id, descripcion, prioridad, estado, fecha_compromiso, calendar_event_id')
    .eq('execution_id', executionId)
    .order('fecha_compromiso', { ascending: true });
  const rows = acciones ?? [];

  const eventIds = [
    ...new Set(rows.map((r) => r.calendar_event_id).filter((x): x is string => x != null)),
  ];
  const fechaByEventId = new Map<string, string>();
  if (eventIds.length > 0) {
    const { data: events } = await sb
      .from('calendar_events')
      .select('id, fecha_vencimiento')
      .in('id', eventIds);
    for (const e of events ?? []) fechaByEventId.set(e.id, e.fecha_vencimiento);
  }

  return rows.map((r) => ({
    id: r.id,
    descripcion: r.descripcion,
    prioridad: r.prioridad,
    estado: r.estado,
    fecha_compromiso: r.fecha_compromiso,
    calendar_event_id: r.calendar_event_id,
    calendar_event_fecha_vencimiento: r.calendar_event_id
      ? (fechaByEventId.get(r.calendar_event_id) ?? null)
      : null,
  }));
}

/**
 * ¿La ejecución es la cabeza vigente de su cadena? (espeja la vista
 * checklist_executions_vigentes: anulacion=false AND sin hijo que la corrija).
 * El único hijo posible en checklists es el tombstone de anulación → `false`
 * = anulada/superseded.
 */
async function isEjecucionVigente(sb: Sb, execution: ChecklistExecutionRow): Promise<boolean> {
  if (execution.anulacion) return false;
  const { data } = await sb
    .from('checklist_executions')
    .select('id')
    .eq('corrige_id', execution.id)
    .limit(1)
    .maybeSingle();
  return data == null;
}

export type EjecucionForDetail = EjecucionForPdf & {
  acciones: CapaForDetail[];
  /** Cabeza vigente (cerrada head). false = anulada/superseded → banner read-only. */
  esVigente: boolean;
};

/**
 * Datos completos del detalle de una ejecución cerrada/anulada (T-061b): el mismo
 * shape del PDF + sus CAPAs (con fecha de calendario) + flag de vigencia. El page
 * firma firma/adjuntos sobre este shape (igual que el print page). `null` si no
 * existe / RLS / cross-tenant.
 */
export async function getEjecucionForDetail(
  sb: Sb,
  executionId: string,
): Promise<EjecucionForDetail | null> {
  const base = await getEjecucionForPdf(sb, executionId);
  if (!base) return null;
  const [acciones, esVigente] = await Promise.all([
    getAccionesForExecution(sb, executionId),
    isEjecucionVigente(sb, base.execution),
  ]);
  return { ...base, acciones, esVigente };
}
