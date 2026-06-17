'use server';

import type { AccessFailure } from '@/shared/auth/with-billing';
import type { Database } from '@/shared/supabase/types';
import type { VersionEditContext } from './queries';
import { revalidatePath } from 'next/cache';

import { requireOwnerWithBilling } from '@/shared/auth/with-billing';
import { logger } from '@/shared/observability/logger';
import { createClient } from '@/shared/supabase/server';

import {
  computeUniqueTemplateName,
  getItemEditContext,
  getSectionEditContext,
  getVersionEditContext,
} from './queries';
import {
  addItemSchema,
  addSectionSchema,
  archiveTemplateSchema,
  cloneSystemTemplateSchema,
  createChecklistTemplateSchema,
  deleteItemSchema,
  deleteSectionSchema,
  editPublishedTemplateSchema,
  publishVersionSchema,
  reorderItemsSchema,
  reorderSectionsSchema,
  restoreTemplateSchema,
  updateItemSchema,
  updateSectionSchema,
  updateTemplateMetaSchema,
} from './schema';

type ChecklistTemplateUpdate = Database['public']['Tables']['checklist_templates']['Update'];
type TemplateSectionInsert = Database['public']['Tables']['template_sections']['Insert'];
type TemplateSectionUpdate = Database['public']['Tables']['template_sections']['Update'];
type TemplateItemInsert = Database['public']['Tables']['template_items']['Insert'];
type TemplateItemUpdate = Database['public']['Tables']['template_items']['Update'];

const RLS_VIOLATION_CODE = '42501';
const UNIQUE_VIOLATION_CODE = '23505';
const TEMPLATE_NAME_INDEX = 'idx_checklist_templates_consultora_nombre';
const ONE_DRAFT_INDEX = 'uq_template_versions_one_draft';

const CLONE_NAME_MAX_ATTEMPTS = 5;

// ============================== Result unions ==============================

type FieldErrors = Record<string, string[]>;

type InvalidInput = {
  ok: false;
  code: 'INVALID_INPUT';
  fieldErrors: FieldErrors;
  message: string;
};

/** Falla común del preámbulo (auth + owner + billing). T-115: alias del shape
 *  compartido `AccessFailure` (antes era una copia local byte-idéntica). */
type AuthBillingFailure = AccessFailure;

type DuplicateName = {
  ok: false;
  code: 'DUPLICATE_NAME';
  fieldErrors: { nombre: string[] };
  message: string;
};

type StructureFailure = {
  ok: false;
  code: 'NOT_FOUND' | 'VERSION_NOT_DRAFT';
  message: string;
};

export type CreateTemplateResult =
  | { ok: true; templateId: string; versionId: string }
  | InvalidInput
  | AuthBillingFailure
  | DuplicateName;

export type EditPublishedResult =
  | { ok: true; templateId: string; versionId: string }
  | { ok: false; code: 'DRAFT_ALREADY_EXISTS'; versionId: string; message: string }
  | { ok: false; code: 'NOT_FOUND'; message: string }
  | InvalidInput
  | AuthBillingFailure;

export type CloneSystemResult =
  | { ok: true; templateId: string; versionId: string }
  | { ok: false; code: 'NOT_FOUND'; message: string }
  | InvalidInput
  | AuthBillingFailure
  | DuplicateName;

export type PublishVersionResult =
  | { ok: true; versionId: string }
  | { ok: false; code: 'NOT_FOUND' | 'VERSION_NOT_DRAFT' | 'VERSION_EMPTY'; message: string }
  | InvalidInput
  | AuthBillingFailure;

export type ArchiveTemplateResult =
  | { ok: true; templateId: string }
  | { ok: false; code: 'NOT_FOUND' | 'ALREADY_ARCHIVED'; message: string }
  | InvalidInput
  | AuthBillingFailure;

export type RestoreTemplateResult =
  | { ok: true; templateId: string }
  | { ok: false; code: 'NOT_FOUND' | 'ALREADY_ACTIVE'; message: string }
  | InvalidInput
  | AuthBillingFailure
  | DuplicateName;

export type UpdateTemplateMetaResult =
  | { ok: true; templateId: string }
  | { ok: false; code: 'NOT_FOUND'; message: string }
  | InvalidInput
  | AuthBillingFailure
  | DuplicateName;

export type SectionMutationResult =
  | { ok: true; sectionId: string }
  | StructureFailure
  | InvalidInput
  | AuthBillingFailure;

export type ItemMutationResult =
  | { ok: true; itemId: string }
  | StructureFailure
  | InvalidInput
  | AuthBillingFailure;

export type ReorderResult =
  | { ok: true }
  | { ok: false; code: 'NOT_FOUND' | 'VERSION_NOT_DRAFT' | 'INVALID_ORDER_SET'; message: string }
  | InvalidInput
  | AuthBillingFailure;

// ============================== Helpers ==============================

function buildInvalidInput(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): { fieldErrors: FieldErrors } {
  const fieldErrors: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path.map((p) => String(p)).join('.') || '_';
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return { fieldErrors };
}

function invalidInput(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
  message = 'Revisá los campos del formulario.',
): InvalidInput {
  const { fieldErrors } = buildInvalidInput(issues);
  return { ok: false, code: 'INVALID_INPUT', fieldErrors, message };
}

// T-115: `requireOwnerWithBilling` se consolidó al helper compartido
// `@/shared/auth/with-billing` (la copia local pre-T-058 era byte-idéntica).

function isNameUniqueViolation(err: { code?: string; message?: string } | null): boolean {
  if (!err || err.code !== UNIQUE_VIOLATION_CODE) return false;
  return (err.message ?? '').includes(TEMPLATE_NAME_INDEX);
}

function isOneDraftViolation(err: { code?: string; message?: string } | null): boolean {
  if (!err || err.code !== UNIQUE_VIOLATION_CODE) return false;
  return (err.message ?? '').includes(ONE_DRAFT_INDEX);
}

/** Token de error emitido por las RPCs (raise exception 'TOKEN'). */
function rpcErrorHas(err: { message?: string } | null, token: string): boolean {
  return (err?.message ?? '').includes(token);
}

/**
 * Versión editable = existe, del tenant (consultora_id NOT NULL) y en draft.
 * Devuelve el fallo (NOT_FOUND / VERSION_NOT_DRAFT) o null si es editable.
 */
function notEditable(vctx: VersionEditContext | null): StructureFailure | null {
  if (!vctx || vctx.consultoraId === null) {
    return { ok: false, code: 'NOT_FOUND', message: 'Elemento no encontrado.' };
  }
  if (vctx.estado !== 'draft') {
    return {
      ok: false,
      code: 'VERSION_NOT_DRAFT',
      message: 'La versión publicada no se puede editar. Editá un borrador.',
    };
  }
  return null;
}

function revalidateChecklists(): void {
  revalidatePath('/checklists');
}

// ============================== Templates ==============================

export async function createChecklistTemplateAction(input: unknown): Promise<CreateTemplateResult> {
  const parsed = createChecklistTemplateSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues);

  const supabase = await createClient();
  const pre = await requireOwnerWithBilling(supabase);
  if (!pre.ok) return pre;

  const { data, error } = await supabase.rpc('create_template_with_draft', {
    p_consultora_id: pre.ctx.consultora.id,
    p_nombre: parsed.data.nombre,
    // '' = sin descripción → la RPC lo convierte a NULL (los args text se tipan `string`).
    p_descripcion: parsed.data.descripcion ?? '',
    p_tipo_inspeccion: parsed.data.tipo_inspeccion,
  });

  if (isNameUniqueViolation(error)) {
    return {
      ok: false,
      code: 'DUPLICATE_NAME',
      fieldErrors: { nombre: ['Ya existe un template activo con ese nombre.'] },
      message: `Ya existe un template activo con nombre "${parsed.data.nombre}".`,
    };
  }
  if (error || !data) {
    logger.error(
      { err: error, userId: pre.ctx.userId, consultoraId: pre.ctx.consultora.id },
      'createChecklistTemplateAction: rpc failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'No se pudo crear el template. Reintentá en unos minutos.',
    };
  }

  const out = data as unknown as { templateId: string; versionId: string };
  revalidateChecklists();
  logger.info(
    {
      templateId: out.templateId,
      versionId: out.versionId,
      userId: pre.ctx.userId,
      consultoraId: pre.ctx.consultora.id,
      action: 'create_checklist_template',
    },
    'createChecklistTemplateAction: created',
  );
  return { ok: true, templateId: out.templateId, versionId: out.versionId };
}

export async function editPublishedTemplateAction(input: unknown): Promise<EditPublishedResult> {
  const parsed = editPublishedTemplateSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues, 'ID inválido.');
  const templateId = parsed.data.templateId;

  const supabase = await createClient();
  const pre = await requireOwnerWithBilling(supabase);
  if (!pre.ok) return pre;

  // Draft ya abierto → devolver su versionId (no se crea un segundo).
  const existing = await findDraftVersionId(supabase, templateId);
  if (existing) {
    return {
      ok: false,
      code: 'DRAFT_ALREADY_EXISTS',
      versionId: existing,
      message: 'Ya existe un borrador abierto para este template.',
    };
  }

  const { data: versionId, error } = await supabase.rpc('clone_template_to_draft', {
    p_template_id: templateId,
  });

  if (error) {
    if (rpcErrorHas(error, 'TEMPLATE_NOT_FOUND') || rpcErrorHas(error, 'NO_PUBLISHED_VERSION')) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: 'No se encontró un template publicado para editar.',
      };
    }
    if (rpcErrorHas(error, 'NOT_OWNER')) {
      return {
        ok: false,
        code: 'FORBIDDEN_NOT_OWNER',
        message: 'Solo el owner puede editar el template.',
      };
    }
    if (isOneDraftViolation(error)) {
      // Carrera: otro clone creó el draft entre el check y la RPC → devolverlo.
      const raced = await findDraftVersionId(supabase, templateId);
      if (raced) {
        return {
          ok: false,
          code: 'DRAFT_ALREADY_EXISTS',
          versionId: raced,
          message: 'Ya existe un borrador abierto para este template.',
        };
      }
    }
    logger.error(
      { err: error, templateId, userId: pre.ctx.userId, consultoraId: pre.ctx.consultora.id },
      'editPublishedTemplateAction: rpc failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'No se pudo crear el borrador. Reintentá en unos minutos.',
    };
  }
  if (!versionId) {
    return { ok: false, code: 'INTERNAL_ERROR', message: 'No se pudo crear el borrador.' };
  }

  revalidateChecklists();
  logger.info(
    {
      templateId,
      versionId,
      userId: pre.ctx.userId,
      consultoraId: pre.ctx.consultora.id,
      action: 'edit_published_template',
    },
    'editPublishedTemplateAction: cloned to draft',
  );
  return { ok: true, templateId, versionId };
}

export async function cloneSystemTemplateAction(input: unknown): Promise<CloneSystemResult> {
  const parsed = cloneSystemTemplateSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues);

  const supabase = await createClient();
  const pre = await requireOwnerWithBilling(supabase);
  if (!pre.ok) return pre;

  const overridden = parsed.data.nombre !== undefined;
  let baseNombre = parsed.data.nombre ?? null;

  if (baseNombre === null) {
    const { data: sys } = await supabase
      .from('checklist_templates')
      .select('nombre, consultora_id')
      .eq('id', parsed.data.systemTemplateId)
      .maybeSingle();
    if (!sys || sys.consultora_id !== null) {
      return { ok: false, code: 'NOT_FOUND', message: 'No se encontró el template de sistema.' };
    }
    baseNombre = sys.nombre;
  }

  // Override → nombre tal cual (colisión = DUPLICATE_NAME). Default → auto-suffix;
  // ante carrera de nombres (23505) recomputamos y reintentamos (acotado).
  for (let attempt = 0; attempt < CLONE_NAME_MAX_ATTEMPTS; attempt += 1) {
    const nombre = overridden ? baseNombre : await computeUniqueTemplateName(supabase, baseNombre);

    const { data, error } = await supabase.rpc('clone_system_template', {
      p_system_template_id: parsed.data.systemTemplateId,
      p_consultora_id: pre.ctx.consultora.id,
      p_nombre: nombre,
    });

    if (!error && data) {
      const out = data as unknown as { templateId: string; versionId: string };
      revalidateChecklists();
      logger.info(
        {
          templateId: out.templateId,
          versionId: out.versionId,
          systemTemplateId: parsed.data.systemTemplateId,
          userId: pre.ctx.userId,
          consultoraId: pre.ctx.consultora.id,
          action: 'clone_system_template',
        },
        'cloneSystemTemplateAction: cloned',
      );
      return { ok: true, templateId: out.templateId, versionId: out.versionId };
    }

    if (
      rpcErrorHas(error, 'SYSTEM_TEMPLATE_NOT_FOUND') ||
      rpcErrorHas(error, 'NO_PUBLISHED_VERSION')
    ) {
      return { ok: false, code: 'NOT_FOUND', message: 'No se encontró el template de sistema.' };
    }
    if (rpcErrorHas(error, 'NOT_OWNER')) {
      return {
        ok: false,
        code: 'FORBIDDEN_NOT_OWNER',
        message: 'Solo el owner puede clonar templates.',
      };
    }
    if (isNameUniqueViolation(error)) {
      if (overridden) {
        return {
          ok: false,
          code: 'DUPLICATE_NAME',
          fieldErrors: { nombre: ['Ya existe un template activo con ese nombre.'] },
          message: `Ya existe un template activo con nombre "${baseNombre}".`,
        };
      }
      continue; // default: recomputar nombre y reintentar.
    }

    logger.error(
      { err: error, userId: pre.ctx.userId, consultoraId: pre.ctx.consultora.id },
      'cloneSystemTemplateAction: rpc failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'No se pudo clonar el template. Reintentá en unos minutos.',
    };
  }

  return {
    ok: false,
    code: 'INTERNAL_ERROR',
    message: 'No se pudo asignar un nombre libre al clon. Reintentá.',
  };
}

export async function publishVersionAction(input: unknown): Promise<PublishVersionResult> {
  const parsed = publishVersionSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues, 'ID inválido.');
  const versionId = parsed.data.versionId;

  const supabase = await createClient();
  const pre = await requireOwnerWithBilling(supabase);
  if (!pre.ok) return pre;

  const vctx = await getVersionEditContext(supabase, versionId);
  if (!vctx || vctx.consultoraId === null) {
    return { ok: false, code: 'NOT_FOUND', message: 'Versión no encontrada.' };
  }
  if (vctx.estado !== 'draft') {
    return {
      ok: false,
      code: 'VERSION_NOT_DRAFT',
      message: 'Solo se puede publicar una versión en borrador.',
    };
  }

  // ≥1 ítem garantiza ≥1 sección (un ítem cuelga de una sección por FK).
  const { count } = await supabase
    .from('template_items')
    .select('id', { count: 'exact', head: true })
    .eq('version_id', versionId);
  if ((count ?? 0) === 0) {
    return {
      ok: false,
      code: 'VERSION_EMPTY',
      message: 'La versión no tiene ítems. Agregá al menos uno antes de publicar.',
    };
  }

  const { data, error } = await supabase
    .from('checklist_template_versions')
    .update({
      estado: 'published',
      published_at: new Date().toISOString(),
      published_by: pre.ctx.userId,
    })
    .eq('id', versionId)
    .eq('estado', 'draft')
    .select('id')
    .maybeSingle();

  if (error?.code === RLS_VIOLATION_CODE) {
    logger.warn(
      { versionId, consultoraId: pre.ctx.consultora.id, err: error.message },
      'publishVersionAction: RLS rejected',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'No se pudo publicar la versión.' };
  }
  if (error) {
    logger.error(
      { err: error, versionId, consultoraId: pre.ctx.consultora.id },
      'publishVersionAction: update failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'No se pudo publicar la versión. Reintentá en unos minutos.',
    };
  }
  if (!data) {
    // 0 filas: dejó de ser draft entre el guard y el update (carrera).
    return { ok: false, code: 'VERSION_NOT_DRAFT', message: 'La versión ya no está en borrador.' };
  }

  revalidateChecklists();
  logger.info(
    {
      versionId,
      userId: pre.ctx.userId,
      consultoraId: pre.ctx.consultora.id,
      action: 'publish_version',
    },
    'publishVersionAction: published',
  );
  return { ok: true, versionId };
}

export async function archiveTemplateAction(input: unknown): Promise<ArchiveTemplateResult> {
  const parsed = archiveTemplateSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues, 'ID inválido.');
  const templateId = parsed.data.templateId;

  const supabase = await createClient();
  const pre = await requireOwnerWithBilling(supabase);
  if (!pre.ok) return pre;

  const { data: existing } = await supabase
    .from('checklist_templates')
    .select('id, archived_at, consultora_id')
    .eq('id', templateId)
    .maybeSingle();
  if (!existing || existing.consultora_id === null) {
    return { ok: false, code: 'NOT_FOUND', message: 'Template no encontrado.' };
  }
  if (existing.archived_at !== null) {
    return { ok: false, code: 'ALREADY_ARCHIVED', message: 'El template ya estaba archivado.' };
  }

  const { data, error } = await supabase
    .from('checklist_templates')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', templateId)
    .select('id')
    .maybeSingle();
  if (error || !data) {
    logger.error(
      { err: error, templateId, consultoraId: pre.ctx.consultora.id },
      'archiveTemplateAction: archive failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'No se pudo archivar el template. Reintentá en unos minutos.',
    };
  }

  revalidateChecklists();
  logger.info(
    {
      templateId,
      userId: pre.ctx.userId,
      consultoraId: pre.ctx.consultora.id,
      action: 'archive_template',
    },
    'archiveTemplateAction: archived',
  );
  return { ok: true, templateId };
}

export async function restoreTemplateAction(input: unknown): Promise<RestoreTemplateResult> {
  const parsed = restoreTemplateSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues, 'ID inválido.');
  const templateId = parsed.data.templateId;

  const supabase = await createClient();
  const pre = await requireOwnerWithBilling(supabase);
  if (!pre.ok) return pre;

  const { data: existing } = await supabase
    .from('checklist_templates')
    .select('id, archived_at, consultora_id')
    .eq('id', templateId)
    .maybeSingle();
  if (!existing || existing.consultora_id === null) {
    return { ok: false, code: 'NOT_FOUND', message: 'Template no encontrado.' };
  }
  if (existing.archived_at === null) {
    return { ok: false, code: 'ALREADY_ACTIVE', message: 'El template ya estaba activo.' };
  }

  const { data, error } = await supabase
    .from('checklist_templates')
    .update({ archived_at: null })
    .eq('id', templateId)
    .select('id')
    .maybeSingle();

  // El índice parcial (consultora_id, nombre) WHERE archived_at IS NULL puede chocar
  // si el nombre se reusó en un template activo mientras este estaba archivado.
  if (isNameUniqueViolation(error)) {
    return {
      ok: false,
      code: 'DUPLICATE_NAME',
      fieldErrors: {
        nombre: ['Ya existe un template activo con ese nombre. Renombralo antes de restaurar.'],
      },
      message: 'No se pudo restaurar: ya hay un template activo con ese nombre.',
    };
  }
  if (error || !data) {
    logger.error(
      { err: error, templateId, consultoraId: pre.ctx.consultora.id },
      'restoreTemplateAction: restore failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'No se pudo restaurar el template. Reintentá en unos minutos.',
    };
  }

  revalidateChecklists();
  logger.info(
    {
      templateId,
      userId: pre.ctx.userId,
      consultoraId: pre.ctx.consultora.id,
      action: 'restore_template',
    },
    'restoreTemplateAction: restored',
  );
  return { ok: true, templateId };
}

/**
 * Edita la meta del template (nombre/descripcion/tipo_inspeccion). Vive en
 * checklist_templates (no en la versión) → editable independientemente del estado
 * de las versiones. Solo templates del tenant (los de sistema son read-only).
 */
export async function updateTemplateMetaAction(input: unknown): Promise<UpdateTemplateMetaResult> {
  const parsed = updateTemplateMetaSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues);
  const templateId = parsed.data.templateId;

  const supabase = await createClient();
  const pre = await requireOwnerWithBilling(supabase);
  if (!pre.ok) return pre;

  const { data: existing } = await supabase
    .from('checklist_templates')
    .select('id, consultora_id')
    .eq('id', templateId)
    .maybeSingle();
  if (!existing || existing.consultora_id === null) {
    return { ok: false, code: 'NOT_FOUND', message: 'Template no encontrado.' };
  }

  const patch: ChecklistTemplateUpdate = {};
  if (parsed.data.nombre !== undefined) patch.nombre = parsed.data.nombre;
  if (parsed.data.descripcion !== undefined) patch.descripcion = parsed.data.descripcion;
  if (parsed.data.tipo_inspeccion !== undefined)
    patch.tipo_inspeccion = parsed.data.tipo_inspeccion;

  const { data, error } = await supabase
    .from('checklist_templates')
    .update(patch)
    .eq('id', templateId)
    .select('id')
    .maybeSingle();

  if (isNameUniqueViolation(error)) {
    return {
      ok: false,
      code: 'DUPLICATE_NAME',
      fieldErrors: { nombre: ['Ya existe un template activo con ese nombre.'] },
      message: `Ya existe un template activo con nombre "${parsed.data.nombre ?? ''}".`,
    };
  }
  if (error || !data) {
    logger.error(
      { err: error, templateId, consultoraId: pre.ctx.consultora.id },
      'updateTemplateMetaAction: update failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'No se pudo actualizar el template. Reintentá en unos minutos.',
    };
  }

  revalidateChecklists();
  logger.info(
    {
      templateId,
      userId: pre.ctx.userId,
      consultoraId: pre.ctx.consultora.id,
      action: 'update_template_meta',
    },
    'updateTemplateMetaAction: updated',
  );
  return { ok: true, templateId };
}

// ============================== Sections ==============================

export async function addSectionAction(input: unknown): Promise<SectionMutationResult> {
  const parsed = addSectionSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues);

  const supabase = await createClient();
  const pre = await requireOwnerWithBilling(supabase);
  if (!pre.ok) return pre;

  const vctx = await getVersionEditContext(supabase, parsed.data.versionId);
  const guard = notEditable(vctx);
  if (guard) return guard;

  const { data: last } = await supabase
    .from('template_sections')
    .select('orden')
    .eq('version_id', parsed.data.versionId)
    .order('orden', { ascending: false })
    .limit(1)
    .maybeSingle();
  const orden = last ? last.orden + 1 : 0;

  const payload: TemplateSectionInsert = {
    version_id: parsed.data.versionId,
    consultora_id: vctx!.consultoraId,
    orden,
    titulo: parsed.data.titulo,
    descripcion: parsed.data.descripcion ?? null,
  };

  const { data, error } = await supabase
    .from('template_sections')
    .insert(payload)
    .select('id')
    .maybeSingle();

  if (error?.code === RLS_VIOLATION_CODE) {
    // Pasó el guard pero la RLS rechazó → la versión dejó de ser draft (carrera).
    return { ok: false, code: 'VERSION_NOT_DRAFT', message: 'La versión ya no está en borrador.' };
  }
  if (error || !data) {
    logger.error(
      { err: error, versionId: parsed.data.versionId, consultoraId: pre.ctx.consultora.id },
      'addSectionAction: insert failed',
    );
    return { ok: false, code: 'NOT_FOUND', message: 'No se pudo agregar la sección.' };
  }

  revalidateChecklists();
  return { ok: true, sectionId: data.id };
}

export async function updateSectionAction(input: unknown): Promise<SectionMutationResult> {
  const parsed = updateSectionSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues);

  const supabase = await createClient();
  const pre = await requireOwnerWithBilling(supabase);
  if (!pre.ok) return pre;

  const vctx = await getSectionEditContext(supabase, parsed.data.sectionId);
  const guard = notEditable(vctx);
  if (guard) return guard;

  const patch: TemplateSectionUpdate = {};
  if (parsed.data.titulo !== undefined) patch.titulo = parsed.data.titulo;
  if (parsed.data.descripcion !== undefined) patch.descripcion = parsed.data.descripcion;

  const { data, error } = await supabase
    .from('template_sections')
    .update(patch)
    .eq('id', parsed.data.sectionId)
    .select('id')
    .maybeSingle();

  if (error?.code === RLS_VIOLATION_CODE) {
    return { ok: false, code: 'VERSION_NOT_DRAFT', message: 'La versión ya no está en borrador.' };
  }
  if (error) {
    logger.error(
      { err: error, sectionId: parsed.data.sectionId, consultoraId: pre.ctx.consultora.id },
      'updateSectionAction: update failed',
    );
    return { ok: false, code: 'NOT_FOUND', message: 'No se pudo actualizar la sección.' };
  }
  if (!data) {
    return { ok: false, code: 'VERSION_NOT_DRAFT', message: 'La versión ya no está en borrador.' };
  }

  revalidateChecklists();
  return { ok: true, sectionId: parsed.data.sectionId };
}

export async function deleteSectionAction(input: unknown): Promise<SectionMutationResult> {
  const parsed = deleteSectionSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues, 'ID inválido.');

  const supabase = await createClient();
  const pre = await requireOwnerWithBilling(supabase);
  if (!pre.ok) return pre;

  const vctx = await getSectionEditContext(supabase, parsed.data.sectionId);
  const guard = notEditable(vctx);
  if (guard) return guard;

  const { data, error } = await supabase
    .from('template_sections')
    .delete()
    .eq('id', parsed.data.sectionId)
    .select('id')
    .maybeSingle();

  if (error?.code === RLS_VIOLATION_CODE) {
    return { ok: false, code: 'VERSION_NOT_DRAFT', message: 'La versión ya no está en borrador.' };
  }
  if (error) {
    logger.error(
      { err: error, sectionId: parsed.data.sectionId, consultoraId: pre.ctx.consultora.id },
      'deleteSectionAction: delete failed',
    );
    return { ok: false, code: 'NOT_FOUND', message: 'No se pudo borrar la sección.' };
  }
  if (!data) {
    return { ok: false, code: 'VERSION_NOT_DRAFT', message: 'La versión ya no está en borrador.' };
  }

  revalidateChecklists();
  return { ok: true, sectionId: parsed.data.sectionId };
}

// ============================== Items ==============================

export async function addItemAction(input: unknown): Promise<ItemMutationResult> {
  const parsed = addItemSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues);

  const supabase = await createClient();
  const pre = await requireOwnerWithBilling(supabase);
  if (!pre.ok) return pre;

  const vctx = await getSectionEditContext(supabase, parsed.data.sectionId);
  const guard = notEditable(vctx);
  if (guard) return guard;

  const { data: last } = await supabase
    .from('template_items')
    .select('orden')
    .eq('section_id', parsed.data.sectionId)
    .order('orden', { ascending: false })
    .limit(1)
    .maybeSingle();
  const orden = last ? last.orden + 1 : 0;

  const payload: TemplateItemInsert = {
    section_id: parsed.data.sectionId,
    version_id: vctx!.versionId,
    consultora_id: vctx!.consultoraId,
    orden,
    texto: parsed.data.texto,
    response_type: parsed.data.response_type,
    es_critico: parsed.data.es_critico,
    es_requerido: parsed.data.es_requerido,
    referencia_normativa: parsed.data.referencia_normativa ?? null,
    config: (parsed.data.config ?? null) as unknown as TemplateItemInsert['config'],
  };

  const { data, error } = await supabase
    .from('template_items')
    .insert(payload)
    .select('id')
    .maybeSingle();

  if (error?.code === RLS_VIOLATION_CODE) {
    return { ok: false, code: 'VERSION_NOT_DRAFT', message: 'La versión ya no está en borrador.' };
  }
  if (error || !data) {
    logger.error(
      { err: error, sectionId: parsed.data.sectionId, consultoraId: pre.ctx.consultora.id },
      'addItemAction: insert failed',
    );
    return { ok: false, code: 'NOT_FOUND', message: 'No se pudo agregar el ítem.' };
  }

  revalidateChecklists();
  return { ok: true, itemId: data.id };
}

export async function updateItemAction(input: unknown): Promise<ItemMutationResult> {
  const parsed = updateItemSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues);

  const supabase = await createClient();
  const pre = await requireOwnerWithBilling(supabase);
  if (!pre.ok) return pre;

  const vctx = await getItemEditContext(supabase, parsed.data.itemId);
  const guard = notEditable(vctx);
  if (guard) return guard;

  const patch: TemplateItemUpdate = {};
  if (parsed.data.texto !== undefined) patch.texto = parsed.data.texto;
  if (parsed.data.response_type !== undefined) patch.response_type = parsed.data.response_type;
  if (parsed.data.es_critico !== undefined) patch.es_critico = parsed.data.es_critico;
  if (parsed.data.es_requerido !== undefined) patch.es_requerido = parsed.data.es_requerido;
  if (parsed.data.referencia_normativa !== undefined) {
    patch.referencia_normativa = parsed.data.referencia_normativa;
  }
  if (parsed.data.config !== undefined) {
    patch.config = parsed.data.config as unknown as TemplateItemUpdate['config'];
  }

  const { data, error } = await supabase
    .from('template_items')
    .update(patch)
    .eq('id', parsed.data.itemId)
    .select('id')
    .maybeSingle();

  if (error?.code === RLS_VIOLATION_CODE) {
    return { ok: false, code: 'VERSION_NOT_DRAFT', message: 'La versión ya no está en borrador.' };
  }
  if (error) {
    logger.error(
      { err: error, itemId: parsed.data.itemId, consultoraId: pre.ctx.consultora.id },
      'updateItemAction: update failed',
    );
    return { ok: false, code: 'NOT_FOUND', message: 'No se pudo actualizar el ítem.' };
  }
  if (!data) {
    return { ok: false, code: 'VERSION_NOT_DRAFT', message: 'La versión ya no está en borrador.' };
  }

  revalidateChecklists();
  return { ok: true, itemId: parsed.data.itemId };
}

export async function deleteItemAction(input: unknown): Promise<ItemMutationResult> {
  const parsed = deleteItemSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues, 'ID inválido.');

  const supabase = await createClient();
  const pre = await requireOwnerWithBilling(supabase);
  if (!pre.ok) return pre;

  const vctx = await getItemEditContext(supabase, parsed.data.itemId);
  const guard = notEditable(vctx);
  if (guard) return guard;

  const { data, error } = await supabase
    .from('template_items')
    .delete()
    .eq('id', parsed.data.itemId)
    .select('id')
    .maybeSingle();

  if (error?.code === RLS_VIOLATION_CODE) {
    return { ok: false, code: 'VERSION_NOT_DRAFT', message: 'La versión ya no está en borrador.' };
  }
  if (error) {
    logger.error(
      { err: error, itemId: parsed.data.itemId, consultoraId: pre.ctx.consultora.id },
      'deleteItemAction: delete failed',
    );
    return { ok: false, code: 'NOT_FOUND', message: 'No se pudo borrar el ítem.' };
  }
  if (!data) {
    return { ok: false, code: 'VERSION_NOT_DRAFT', message: 'La versión ya no está en borrador.' };
  }

  revalidateChecklists();
  return { ok: true, itemId: parsed.data.itemId };
}

// ============================== Reorder ==============================

/** Mapea el error de las RPCs reorder_* a la union. `null` = sin error. */
function mapReorderError(
  err: { message?: string } | null,
): Exclude<ReorderResult, { ok: true }> | null {
  if (!err) return null;
  if (rpcErrorHas(err, 'VERSION_NOT_FOUND') || rpcErrorHas(err, 'SECTION_NOT_FOUND')) {
    return { ok: false, code: 'NOT_FOUND', message: 'Elemento no encontrado. Recargá la página.' };
  }
  if (rpcErrorHas(err, 'NOT_OWNER')) {
    return { ok: false, code: 'FORBIDDEN_NOT_OWNER', message: 'Solo el owner puede reordenar.' };
  }
  if (rpcErrorHas(err, 'VERSION_NOT_DRAFT')) {
    return { ok: false, code: 'VERSION_NOT_DRAFT', message: 'La versión ya no está en borrador.' };
  }
  if (rpcErrorHas(err, 'INVALID_ORDER_SET')) {
    return {
      ok: false,
      code: 'INVALID_ORDER_SET',
      message: 'La lista cambió. Recargá la página e intentá de nuevo.',
    };
  }
  return {
    ok: false,
    code: 'INTERNAL_ERROR',
    message: 'No se pudo reordenar. Reintentá en unos minutos.',
  };
}

export async function reorderSectionsAction(input: unknown): Promise<ReorderResult> {
  const parsed = reorderSectionsSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues);

  const supabase = await createClient();
  const pre = await requireOwnerWithBilling(supabase);
  if (!pre.ok) return pre;

  // Guard determinístico antes de la RPC (la RPC re-valida como backstop de carrera).
  const vctx = await getVersionEditContext(supabase, parsed.data.versionId);
  const guard = notEditable(vctx);
  if (guard) return guard;

  const { error } = await supabase.rpc('reorder_template_sections', {
    p_version_id: parsed.data.versionId,
    p_ordered_ids: parsed.data.orderedIds,
  });

  const mapped = mapReorderError(error);
  if (mapped) {
    if (mapped.code === 'INTERNAL_ERROR') {
      logger.error(
        { err: error, versionId: parsed.data.versionId, consultoraId: pre.ctx.consultora.id },
        'reorderSectionsAction: rpc failed',
      );
    }
    return mapped;
  }

  revalidateChecklists();
  return { ok: true };
}

export async function reorderItemsAction(input: unknown): Promise<ReorderResult> {
  const parsed = reorderItemsSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues);

  const supabase = await createClient();
  const pre = await requireOwnerWithBilling(supabase);
  if (!pre.ok) return pre;

  const vctx = await getSectionEditContext(supabase, parsed.data.sectionId);
  const guard = notEditable(vctx);
  if (guard) return guard;

  const { error } = await supabase.rpc('reorder_template_items', {
    p_section_id: parsed.data.sectionId,
    p_ordered_ids: parsed.data.orderedIds,
  });

  const mapped = mapReorderError(error);
  if (mapped) {
    if (mapped.code === 'INTERNAL_ERROR') {
      logger.error(
        { err: error, sectionId: parsed.data.sectionId, consultoraId: pre.ctx.consultora.id },
        'reorderItemsAction: rpc failed',
      );
    }
    return mapped;
  }

  revalidateChecklists();
  return { ok: true };
}

// ============================== Helpers internos ==============================

async function findDraftVersionId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  templateId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('checklist_template_versions')
    .select('id')
    .eq('template_id', templateId)
    .eq('estado', 'draft')
    .maybeSingle();
  return data?.id ?? null;
}
