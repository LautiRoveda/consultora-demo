import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

import { pickUniqueTemplateName } from './naming';

export type ChecklistTemplateRow = Database['public']['Tables']['checklist_templates']['Row'];
export type ChecklistTemplateVersionRow =
  Database['public']['Tables']['checklist_template_versions']['Row'];
export type TemplateSectionRow = Database['public']['Tables']['template_sections']['Row'];
export type TemplateItemRow = Database['public']['Tables']['template_items']['Row'];

// Las queries reciben el `supabase` del request y NO un `consultora_id`: la RLS
// filtra por el claim del JWT. Las tablas de template además exponen las filas de
// sistema (consultora_id IS NULL) vía la policy SELECT.

export type ChecklistTemplateListItem = ChecklistTemplateRow & { isSystem: boolean };

export type GetChecklistTemplatesOptions = { includeArchived?: boolean };

/**
 * Templates visibles para el tenant: los propios + los de sistema (RGRL). Marca
 * `isSystem` (consultora_id IS NULL) para que la UI distinga catálogo vs sistema.
 */
export async function getChecklistTemplates(
  supabase: SupabaseClient<Database>,
  options: GetChecklistTemplatesOptions = {},
): Promise<ChecklistTemplateListItem[]> {
  const includeArchived = options.includeArchived ?? false;

  let query = supabase
    .from('checklist_templates')
    .select('*')
    .order('nombre', { ascending: true })
    .order('id', { ascending: true });

  if (!includeArchived) query = query.is('archived_at', null);

  const { data } = await query;
  return (data ?? []).map((t) => ({ ...t, isSystem: t.consultora_id === null }));
}

export type TemplateSectionNode = TemplateSectionRow & { items: TemplateItemRow[] };

export type TemplateWithStructure = {
  template: ChecklistTemplateRow;
  version: ChecklistTemplateVersionRow;
  sections: TemplateSectionNode[];
};

export type GetTemplateStructureOptions = {
  /** Versión exacta. Tiene prioridad sobre `which`. */
  versionId?: string;
  /** 'published' (default, última publicada) o 'draft' (la versión editable). */
  which?: 'published' | 'draft';
};

/**
 * Template + una de sus versiones (default: última `published`; o el `draft`, o
 * una `versionId` puntual) + sections/items ordenados por `orden`. `null` si el
 * template no existe (RLS) o no hay versión que matchee.
 */
export async function getTemplateWithStructure(
  supabase: SupabaseClient<Database>,
  templateId: string,
  options: GetTemplateStructureOptions = {},
): Promise<TemplateWithStructure | null> {
  const { data: template } = await supabase
    .from('checklist_templates')
    .select('*')
    .eq('id', templateId)
    .maybeSingle();
  if (!template) return null;

  let version: ChecklistTemplateVersionRow | null = null;
  if (options.versionId) {
    const { data } = await supabase
      .from('checklist_template_versions')
      .select('*')
      .eq('id', options.versionId)
      .eq('template_id', templateId)
      .maybeSingle();
    version = data;
  } else if (options.which === 'draft') {
    const { data } = await supabase
      .from('checklist_template_versions')
      .select('*')
      .eq('template_id', templateId)
      .eq('estado', 'draft')
      .maybeSingle();
    version = data;
  } else {
    const { data } = await supabase
      .from('checklist_template_versions')
      .select('*')
      .eq('template_id', templateId)
      .eq('estado', 'published')
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    version = data;
  }
  if (!version) return null;

  const [{ data: sections }, { data: items }] = await Promise.all([
    supabase
      .from('template_sections')
      .select('*')
      .eq('version_id', version.id)
      .order('orden', { ascending: true }),
    supabase
      .from('template_items')
      .select('*')
      .eq('version_id', version.id)
      .order('orden', { ascending: true }),
  ]);

  const itemsBySection = new Map<string, TemplateItemRow[]>();
  for (const item of items ?? []) {
    const arr = itemsBySection.get(item.section_id);
    if (arr) arr.push(item);
    else itemsBySection.set(item.section_id, [item]);
  }

  const sectionNodes: TemplateSectionNode[] = (sections ?? []).map((s) => ({
    ...s,
    items: itemsBySection.get(s.id) ?? [],
  }));

  return { template, version, sections: sectionNodes };
}

/**
 * Historial de versiones de un template (más nueva primero).
 */
export async function getTemplateVersions(
  supabase: SupabaseClient<Database>,
  templateId: string,
): Promise<ChecklistTemplateVersionRow[]> {
  const { data } = await supabase
    .from('checklist_template_versions')
    .select('*')
    .eq('template_id', templateId)
    .order('version_number', { ascending: false });
  return data ?? [];
}

// ============================== Guards de edición ==============================
// Resuelven la versión padre + su estado para que las structure ops devuelvan
// codes determinísticos (NOT_FOUND vs VERSION_NOT_DRAFT) antes de la op; la RLS
// queda como backstop. `null` = no existe / cross-tenant oculto por RLS.

export type VersionEditContext = {
  versionId: string;
  estado: string;
  consultoraId: string | null;
};

export async function getVersionEditContext(
  supabase: SupabaseClient<Database>,
  versionId: string,
): Promise<VersionEditContext | null> {
  const { data } = await supabase
    .from('checklist_template_versions')
    .select('id, estado, consultora_id')
    .eq('id', versionId)
    .maybeSingle();
  if (!data) return null;
  return { versionId: data.id, estado: data.estado, consultoraId: data.consultora_id };
}

export async function getSectionEditContext(
  supabase: SupabaseClient<Database>,
  sectionId: string,
): Promise<VersionEditContext | null> {
  const { data } = await supabase
    .from('template_sections')
    .select('version_id')
    .eq('id', sectionId)
    .maybeSingle();
  if (!data) return null;
  return getVersionEditContext(supabase, data.version_id);
}

export async function getItemEditContext(
  supabase: SupabaseClient<Database>,
  itemId: string,
): Promise<VersionEditContext | null> {
  // template_items.version_id está denormalizado → no necesita join a la sección.
  const { data } = await supabase
    .from('template_items')
    .select('version_id')
    .eq('id', itemId)
    .maybeSingle();
  if (!data) return null;
  return getVersionEditContext(supabase, data.version_id);
}

// ============================== Helpers de nombre ==============================

/**
 * Computa un nombre de template libre dentro del tenant (índice único
 * `(consultora_id, nombre) WHERE archived_at IS NULL`). Devuelve `base` si está
 * libre; si no, `base (copia)`, `base (copia 2)`, … Capa el resultado a NOMBRE_MAX.
 * Las filas de sistema (consultora_id NULL) NO cuentan (índice separado).
 *
 * Es best-effort (TOCTOU): la action que la usa cachea el 23505 y reintenta.
 */
export async function computeUniqueTemplateName(
  supabase: SupabaseClient<Database>,
  base: string,
): Promise<string> {
  const { data } = await supabase
    .from('checklist_templates')
    .select('nombre, consultora_id, archived_at')
    .is('archived_at', null);

  const taken = new Set((data ?? []).filter((t) => t.consultora_id !== null).map((t) => t.nombre));

  return pickUniqueTemplateName(base, taken);
}
