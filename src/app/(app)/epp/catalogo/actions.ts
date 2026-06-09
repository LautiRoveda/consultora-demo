'use server';

import type { Database } from '@/shared/supabase/types';
import { revalidatePath } from 'next/cache';

import { requireOwner } from '@/shared/auth/requireOwner';
import { logger } from '@/shared/observability/logger';
import { createClient } from '@/shared/supabase/server';

import {
  createCategoriaSchema,
  createItemSchema,
  createPuestoSchema,
  entityIdSchema,
  updateCategoriaPatchSchema,
  updateItemPatchSchema,
  updatePuestoPatchSchema,
} from './schema';

type CategoriaInsert = Database['public']['Tables']['epp_categorias']['Insert'];
type CategoriaUpdate = Database['public']['Tables']['epp_categorias']['Update'];
type ItemInsert = Database['public']['Tables']['epp_items']['Insert'];
type ItemUpdate = Database['public']['Tables']['epp_items']['Update'];
type PuestoInsert = Database['public']['Tables']['puestos']['Insert'];
type PuestoUpdate = Database['public']['Tables']['puestos']['Update'];

const RLS_VIOLATION_CODE = '42501';
const UNIQUE_VIOLATION_CODE = '23505';
const CHECK_VIOLATION_CODE = '23514';
const FK_VIOLATION_CODE = '23503';

// ============================== Result types ===============================

type FieldErrors = Record<string, string[]>;

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: FieldErrors; message: string }
  | {
      ok: false;
      code:
        | 'UNAUTHENTICATED'
        | 'NO_CONSULTORA'
        | 'FORBIDDEN_NOT_OWNER'
        | 'NOT_FOUND'
        | 'INTERNAL_ERROR';
      message: string;
    }
  | { ok: false; code: 'DUPLICATE_NAME'; fieldErrors: { nombre: string[] }; message: string };

export type UpdateResult =
  | { ok: true; id: string }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: FieldErrors; message: string }
  | {
      ok: false;
      code:
        | 'UNAUTHENTICATED'
        | 'NO_CONSULTORA'
        | 'NOT_FOUND'
        | 'FORBIDDEN_NOT_OWNER'
        | 'INTERNAL_ERROR';
      message: string;
    }
  | { ok: false; code: 'DUPLICATE_NAME'; fieldErrors: { nombre: string[] }; message: string };

export type ArchiveResult =
  | { ok: true; id: string }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: FieldErrors; message: string }
  | {
      ok: false;
      code:
        | 'UNAUTHENTICATED'
        | 'NO_CONSULTORA'
        | 'NOT_FOUND'
        | 'ALREADY_ARCHIVED'
        | 'FORBIDDEN_NOT_OWNER'
        | 'INTERNAL_ERROR';
      message: string;
    };

export type RestoreResult =
  | { ok: true; id: string }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: FieldErrors; message: string }
  | {
      ok: false;
      code:
        | 'UNAUTHENTICATED'
        | 'NO_CONSULTORA'
        | 'NOT_FOUND'
        | 'ALREADY_ACTIVE'
        | 'FORBIDDEN_NOT_OWNER'
        | 'INTERNAL_ERROR';
      message: string;
    }
  | { ok: false; code: 'DUPLICATE_NAME'; fieldErrors: { nombre: string[] }; message: string };

export type SeedResult =
  | {
      ok: true;
      created: { categorias: number; items: number; puestos: number };
    }
  | {
      ok: false;
      code: 'UNAUTHENTICATED' | 'NO_CONSULTORA' | 'FORBIDDEN_NOT_OWNER' | 'INTERNAL_ERROR';
      message: string;
    };

// =============================== Helpers ===================================

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

function isUniqueNameViolation(err: { code?: string } | null): boolean {
  return err?.code === UNIQUE_VIOLATION_CODE;
}

// Invalida cachés del catálogo + páginas hijas. Llamar tras cada mutación.
function revalidateCatalog(): void {
  revalidatePath('/epp/catalogo');
  revalidatePath('/epp/catalogo/categorias');
  revalidatePath('/epp/catalogo/items');
  revalidatePath('/epp/catalogo/puestos');
}

// ============================ CATEGORIAS ===================================

export async function createCategoriaAction(input: unknown): Promise<CreateResult> {
  const parsed = createCategoriaSchema.safeParse(input);
  if (!parsed.success) {
    const { fieldErrors } = buildInvalidInput(parsed.error.issues);
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors,
      message: 'Revisá los campos del formulario.',
    };
  }

  const supabase = await createClient();
  const auth = await requireOwner(supabase);
  if (!auth.ok) return auth;

  const payload: CategoriaInsert = {
    nombre: parsed.data.nombre,
    descripcion: parsed.data.descripcion,
    consultora_id: auth.ctx.consultoraId,
    created_by: auth.ctx.userId,
  };

  const { data, error } = await supabase
    .from('epp_categorias')
    .insert(payload)
    .select('id')
    .single();

  if (isUniqueNameViolation(error)) {
    return {
      ok: false,
      code: 'DUPLICATE_NAME',
      fieldErrors: { nombre: ['Ya existe una categoría activa con ese nombre.'] },
      message: `Ya existe una categoría activa con nombre "${parsed.data.nombre}".`,
    };
  }

  if (error?.code === RLS_VIOLATION_CODE) {
    logger.warn(
      { userId: auth.ctx.userId, consultoraId: auth.ctx.consultoraId, err: error.message },
      'createCategoriaAction: RLS rejected insert',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'No se pudo crear la categoría.' };
  }

  if (error || !data) {
    logger.error(
      { err: error, userId: auth.ctx.userId, consultoraId: auth.ctx.consultoraId },
      'createCategoriaAction: insert failed',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Hubo un error creando la categoría.' };
  }

  revalidateCatalog();
  logger.info(
    {
      categoriaId: data.id,
      userId: auth.ctx.userId,
      consultoraId: auth.ctx.consultoraId,
      action: 'create_epp_categoria',
    },
    'createCategoriaAction: created',
  );
  return { ok: true, id: data.id };
}

export async function updateCategoriaAction(id: unknown, patch: unknown): Promise<UpdateResult> {
  const idParsed = entityIdSchema.safeParse(id);
  if (!idParsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: buildInvalidInput(idParsed.error.issues).fieldErrors,
      message: 'ID inválido.',
    };
  }

  const patchParsed = updateCategoriaPatchSchema.safeParse(patch);
  if (!patchParsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: buildInvalidInput(patchParsed.error.issues).fieldErrors,
      message: 'Revisá los campos del formulario.',
    };
  }

  const supabase = await createClient();
  const auth = await requireOwner(supabase);
  if (!auth.ok) return auth;

  const { data: existing } = await supabase
    .from('epp_categorias')
    .select('id')
    .eq('id', idParsed.data)
    .maybeSingle();
  if (!existing) {
    return { ok: false, code: 'NOT_FOUND', message: 'Categoría no encontrada.' };
  }

  const payload: CategoriaUpdate = { ...patchParsed.data };
  const { data, error } = await supabase
    .from('epp_categorias')
    .update(payload)
    .eq('id', idParsed.data)
    .select('id')
    .single();

  if (isUniqueNameViolation(error)) {
    const newName = typeof payload.nombre === 'string' ? payload.nombre : 'ese nombre';
    return {
      ok: false,
      code: 'DUPLICATE_NAME',
      fieldErrors: { nombre: ['Ya existe una categoría activa con ese nombre.'] },
      message: `Ya existe una categoría activa con nombre "${newName}".`,
    };
  }

  if (error || !data) {
    logger.error(
      {
        err: error,
        userId: auth.ctx.userId,
        consultoraId: auth.ctx.consultoraId,
        categoriaId: idParsed.data,
      },
      'updateCategoriaAction: update failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Hubo un error actualizando la categoría.',
    };
  }

  revalidateCatalog();
  return { ok: true, id: data.id };
}

export async function archiveCategoriaAction(id: unknown): Promise<ArchiveResult> {
  return archiveGeneric(id, 'epp_categorias', 'Categoría');
}

export async function restoreCategoriaAction(id: unknown): Promise<RestoreResult> {
  return restoreGeneric(id, 'epp_categorias', 'Categoría');
}

// ============================ ITEMS ========================================

export async function createItemAction(input: unknown): Promise<CreateResult> {
  const parsed = createItemSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: buildInvalidInput(parsed.error.issues).fieldErrors,
      message: 'Revisá los campos del formulario.',
    };
  }

  const supabase = await createClient();
  const auth = await requireOwner(supabase);
  if (!auth.ok) return auth;

  // Defense in depth: verificar que la categoría pertenece al tenant (RLS
  // bloquea reads cross-tenant → null). El FK + RLS de epp_items también
  // bloquearía el INSERT, pero este check da un error más limpio al user.
  const { data: cat } = await supabase
    .from('epp_categorias')
    .select('id')
    .eq('id', parsed.data.categoria_id)
    .maybeSingle();
  if (!cat) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: { categoria_id: ['La categoría no existe o no pertenece a tu consultora.'] },
      message: 'Categoría inválida.',
    };
  }

  const payload: ItemInsert = {
    nombre: parsed.data.nombre,
    categoria_id: parsed.data.categoria_id,
    vida_util_meses: parsed.data.vida_util_meses,
    es_descartable: parsed.data.es_descartable,
    requiere_numero_serie: parsed.data.requiere_numero_serie,
    marca_default: parsed.data.marca_default,
    modelo_default: parsed.data.modelo_default,
    normativa: parsed.data.normativa,
    notas: parsed.data.notas,
    consultora_id: auth.ctx.consultoraId,
    created_by: auth.ctx.userId,
  };

  const { data, error } = await supabase.from('epp_items').insert(payload).select('id').single();

  if (error?.code === FK_VIOLATION_CODE) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: { categoria_id: ['Categoría inválida.'] },
      message: 'Categoría inválida.',
    };
  }

  if (error || !data) {
    logger.error(
      { err: error, userId: auth.ctx.userId, consultoraId: auth.ctx.consultoraId },
      'createItemAction: insert failed',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Hubo un error creando el item.' };
  }

  revalidateCatalog();
  logger.info(
    {
      itemId: data.id,
      userId: auth.ctx.userId,
      consultoraId: auth.ctx.consultoraId,
      action: 'create_epp_item',
    },
    'createItemAction: created',
  );
  return { ok: true, id: data.id };
}

export async function updateItemAction(id: unknown, patch: unknown): Promise<UpdateResult> {
  const idParsed = entityIdSchema.safeParse(id);
  if (!idParsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: buildInvalidInput(idParsed.error.issues).fieldErrors,
      message: 'ID inválido.',
    };
  }

  const patchParsed = updateItemPatchSchema.safeParse(patch);
  if (!patchParsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: buildInvalidInput(patchParsed.error.issues).fieldErrors,
      message: 'Revisá los campos del formulario.',
    };
  }

  const supabase = await createClient();
  const auth = await requireOwner(supabase);
  if (!auth.ok) return auth;

  const { data: existing } = await supabase
    .from('epp_items')
    .select('id')
    .eq('id', idParsed.data)
    .maybeSingle();
  if (!existing) {
    return { ok: false, code: 'NOT_FOUND', message: 'Item no encontrado.' };
  }

  // Si el patch incluye nueva categoria_id, validar tenant ownership (mismo
  // guard que en create — FK + RLS bloquea pero el error es más confuso).
  if (typeof patchParsed.data.categoria_id === 'string') {
    const { data: cat } = await supabase
      .from('epp_categorias')
      .select('id')
      .eq('id', patchParsed.data.categoria_id)
      .maybeSingle();
    if (!cat) {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        fieldErrors: { categoria_id: ['La categoría no existe o no pertenece a tu consultora.'] },
        message: 'Categoría inválida.',
      };
    }
  }

  const payload: ItemUpdate = { ...patchParsed.data };
  const { data, error } = await supabase
    .from('epp_items')
    .update(payload)
    .eq('id', idParsed.data)
    .select('id')
    .single();

  if (error?.code === FK_VIOLATION_CODE) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: { categoria_id: ['Categoría inválida.'] },
      message: 'Categoría inválida.',
    };
  }

  if (error?.code === CHECK_VIOLATION_CODE) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: { _: [error.message] },
      message: 'Algún campo no cumple las restricciones.',
    };
  }

  if (error || !data) {
    logger.error(
      {
        err: error,
        userId: auth.ctx.userId,
        consultoraId: auth.ctx.consultoraId,
        itemId: idParsed.data,
      },
      'updateItemAction: update failed',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Hubo un error actualizando el item.' };
  }

  revalidateCatalog();
  return { ok: true, id: data.id };
}

export async function archiveItemAction(id: unknown): Promise<ArchiveResult> {
  return archiveGeneric(id, 'epp_items', 'Item');
}

export async function restoreItemAction(id: unknown): Promise<RestoreResult> {
  return restoreGeneric(id, 'epp_items', 'Item');
}

// ============================ PUESTOS ======================================

export async function createPuestoAction(input: unknown): Promise<CreateResult> {
  const parsed = createPuestoSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: buildInvalidInput(parsed.error.issues).fieldErrors,
      message: 'Revisá los campos del formulario.',
    };
  }

  const supabase = await createClient();
  const auth = await requireOwner(supabase);
  if (!auth.ok) return auth;

  const payload: PuestoInsert = {
    nombre: parsed.data.nombre,
    descripcion: parsed.data.descripcion,
    riesgos_asociados: parsed.data.riesgos_asociados,
    consultora_id: auth.ctx.consultoraId,
    created_by: auth.ctx.userId,
  };

  const { data, error } = await supabase.from('puestos').insert(payload).select('id').single();

  if (isUniqueNameViolation(error)) {
    return {
      ok: false,
      code: 'DUPLICATE_NAME',
      fieldErrors: { nombre: ['Ya existe un puesto activo con ese nombre.'] },
      message: `Ya existe un puesto activo con nombre "${parsed.data.nombre}".`,
    };
  }

  if (error || !data) {
    logger.error(
      { err: error, userId: auth.ctx.userId, consultoraId: auth.ctx.consultoraId },
      'createPuestoAction: insert failed',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Hubo un error creando el puesto.' };
  }

  revalidateCatalog();
  logger.info(
    {
      puestoId: data.id,
      userId: auth.ctx.userId,
      consultoraId: auth.ctx.consultoraId,
      action: 'create_puesto',
    },
    'createPuestoAction: created',
  );
  return { ok: true, id: data.id };
}

export async function updatePuestoAction(id: unknown, patch: unknown): Promise<UpdateResult> {
  const idParsed = entityIdSchema.safeParse(id);
  if (!idParsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: buildInvalidInput(idParsed.error.issues).fieldErrors,
      message: 'ID inválido.',
    };
  }

  const patchParsed = updatePuestoPatchSchema.safeParse(patch);
  if (!patchParsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: buildInvalidInput(patchParsed.error.issues).fieldErrors,
      message: 'Revisá los campos del formulario.',
    };
  }

  const supabase = await createClient();
  const auth = await requireOwner(supabase);
  if (!auth.ok) return auth;

  const { data: existing } = await supabase
    .from('puestos')
    .select('id')
    .eq('id', idParsed.data)
    .maybeSingle();
  if (!existing) {
    return { ok: false, code: 'NOT_FOUND', message: 'Puesto no encontrado.' };
  }

  const payload: PuestoUpdate = { ...patchParsed.data };
  const { data, error } = await supabase
    .from('puestos')
    .update(payload)
    .eq('id', idParsed.data)
    .select('id')
    .single();

  if (isUniqueNameViolation(error)) {
    const newName = typeof payload.nombre === 'string' ? payload.nombre : 'ese nombre';
    return {
      ok: false,
      code: 'DUPLICATE_NAME',
      fieldErrors: { nombre: ['Ya existe un puesto activo con ese nombre.'] },
      message: `Ya existe un puesto activo con nombre "${newName}".`,
    };
  }

  if (error || !data) {
    logger.error(
      {
        err: error,
        userId: auth.ctx.userId,
        consultoraId: auth.ctx.consultoraId,
        puestoId: idParsed.data,
      },
      'updatePuestoAction: update failed',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Hubo un error actualizando el puesto.' };
  }

  revalidateCatalog();
  return { ok: true, id: data.id };
}

export async function archivePuestoAction(id: unknown): Promise<ArchiveResult> {
  return archiveGeneric(id, 'puestos', 'Puesto');
}

export async function restorePuestoAction(id: unknown): Promise<RestoreResult> {
  return restoreGeneric(id, 'puestos', 'Puesto');
}

// ============================ GENERIC ARCHIVE/RESTORE ======================

type ArchivableTable = 'epp_categorias' | 'epp_items' | 'puestos';

async function archiveGeneric(
  id: unknown,
  table: ArchivableTable,
  label: string,
): Promise<ArchiveResult> {
  const idParsed = entityIdSchema.safeParse(id);
  if (!idParsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: buildInvalidInput(idParsed.error.issues).fieldErrors,
      message: 'ID inválido.',
    };
  }

  const supabase = await createClient();
  const auth = await requireOwner(supabase);
  if (!auth.ok) return auth;

  const { data: existing } = await supabase
    .from(table)
    .select('id, archived_at')
    .eq('id', idParsed.data)
    .maybeSingle();
  if (!existing) {
    return { ok: false, code: 'NOT_FOUND', message: `${label} no encontrado.` };
  }
  if (existing.archived_at !== null) {
    return { ok: false, code: 'ALREADY_ARCHIVED', message: `${label} ya estaba archivado.` };
  }

  const { data, error } = await supabase
    .from(table)
    .update({ archived_at: new Date().toISOString() })
    .eq('id', idParsed.data)
    .select('id')
    .single();

  if (error || !data) {
    logger.error(
      {
        err: error,
        userId: auth.ctx.userId,
        consultoraId: auth.ctx.consultoraId,
        table,
        entityId: idParsed.data,
      },
      'archiveGeneric: archive failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: `Hubo un error archivando el ${label.toLowerCase()}.`,
    };
  }

  revalidateCatalog();
  return { ok: true, id: data.id };
}

async function restoreGeneric(
  id: unknown,
  table: ArchivableTable,
  label: string,
): Promise<RestoreResult> {
  const idParsed = entityIdSchema.safeParse(id);
  if (!idParsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: buildInvalidInput(idParsed.error.issues).fieldErrors,
      message: 'ID inválido.',
    };
  }

  const supabase = await createClient();
  const auth = await requireOwner(supabase);
  if (!auth.ok) return auth;

  const { data: existing } = await supabase
    .from(table)
    .select('id, archived_at')
    .eq('id', idParsed.data)
    .maybeSingle();
  if (!existing) {
    return { ok: false, code: 'NOT_FOUND', message: `${label} no encontrado.` };
  }
  if (existing.archived_at === null) {
    return { ok: false, code: 'ALREADY_ACTIVE', message: `${label} ya estaba activo.` };
  }

  const { data, error } = await supabase
    .from(table)
    .update({ archived_at: null })
    .eq('id', idParsed.data)
    .select('id')
    .single();

  // Edge case categorías/puestos: si mientras estaba archivado se creó otro
  // con el mismo nombre, el restore viola UNIQUE partial → 23505.
  if (isUniqueNameViolation(error)) {
    return {
      ok: false,
      code: 'DUPLICATE_NAME',
      fieldErrors: { nombre: [`Existe otro ${label.toLowerCase()} activo con el mismo nombre.`] },
      message: `No podés restaurar este ${label.toLowerCase()}: ya existe otro activo con el mismo nombre. Archivá el otro primero o renombrá este.`,
    };
  }

  if (error || !data) {
    logger.error(
      {
        err: error,
        userId: auth.ctx.userId,
        consultoraId: auth.ctx.consultoraId,
        table,
        entityId: idParsed.data,
      },
      'restoreGeneric: restore failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: `Hubo un error restaurando el ${label.toLowerCase()}.`,
    };
  }

  revalidateCatalog();
  return { ok: true, id: data.id };
}

// ============================ SEED DEFAULT CATALOG =========================

type CategoriaDefault = {
  nombre: string;
  descripcion: string;
};

type ItemDefault = {
  nombre: string;
  categoria_nombre: string;
  vida_util_meses: number;
  es_descartable: boolean;
  requiere_numero_serie: boolean;
  normativa?: string;
};

type PuestoDefault = {
  nombre: string;
  descripcion: string;
  riesgos_asociados: string[];
};

const CATEGORIAS_DEFAULT: ReadonlyArray<CategoriaDefault> = [
  { nombre: 'Protección cabeza', descripcion: 'Casco, barbiquejo, capucha térmica' },
  { nombre: 'Protección manos', descripcion: 'Guantes de uso general y especializado' },
  { nombre: 'Protección pies', descripcion: 'Borcegos, botas, calzado dieléctrico' },
  { nombre: 'Protección ocular y facial', descripcion: 'Antiparras, careta de soldar' },
  { nombre: 'Protección caída altura', descripcion: 'Arnés, línea de vida, cabo' },
  { nombre: 'Protección respiratoria', descripcion: 'Barbijo, respirador, filtros' },
  { nombre: 'Protección auditiva', descripcion: 'Protector endaural o copa' },
  { nombre: 'Ropa de trabajo', descripcion: 'Camisa, pantalón, mameluco, alta visibilidad' },
] as const;

const ITEMS_DEFAULT: ReadonlyArray<ItemDefault> = [
  {
    nombre: 'Casco clase A',
    categoria_nombre: 'Protección cabeza',
    vida_util_meses: 6,
    es_descartable: false,
    requiere_numero_serie: false,
    normativa: 'IRAM 3620',
  },
  {
    nombre: 'Antiparras transparentes',
    categoria_nombre: 'Protección ocular y facial',
    vida_util_meses: 6,
    es_descartable: true,
    requiere_numero_serie: false,
  },
  {
    nombre: 'Antiparras anti-impacto',
    categoria_nombre: 'Protección ocular y facial',
    vida_util_meses: 12,
    es_descartable: false,
    requiere_numero_serie: false,
    normativa: 'IRAM 3733',
  },
  {
    nombre: 'Guantes nitrilo descartables',
    categoria_nombre: 'Protección manos',
    vida_util_meses: 6,
    es_descartable: true,
    requiere_numero_serie: false,
  },
  {
    nombre: 'Guantes vaqueta cuero',
    categoria_nombre: 'Protección manos',
    vida_util_meses: 6,
    es_descartable: false,
    requiere_numero_serie: false,
    normativa: 'IRAM 3607',
  },
  {
    nombre: 'Borcegos seguridad puntera acero',
    categoria_nombre: 'Protección pies',
    vida_util_meses: 6,
    es_descartable: false,
    requiere_numero_serie: false,
    normativa: 'IRAM 3610',
  },
  {
    nombre: 'Calzado dieléctrico',
    categoria_nombre: 'Protección pies',
    vida_util_meses: 6,
    es_descartable: false,
    requiere_numero_serie: false,
    normativa: 'IRAM 3641',
  },
  {
    nombre: 'Camisa trabajo',
    categoria_nombre: 'Ropa de trabajo',
    vida_util_meses: 6,
    es_descartable: false,
    requiere_numero_serie: false,
  },
  {
    nombre: 'Pantalón trabajo',
    categoria_nombre: 'Ropa de trabajo',
    vida_util_meses: 6,
    es_descartable: false,
    requiere_numero_serie: false,
  },
  {
    nombre: 'Mameluco alta visibilidad',
    categoria_nombre: 'Ropa de trabajo',
    vida_util_meses: 6,
    es_descartable: false,
    requiere_numero_serie: false,
    normativa: 'IRAM-IAS U500-168',
  },
  {
    nombre: 'Arnés cuerpo entero',
    categoria_nombre: 'Protección caída altura',
    vida_util_meses: 12,
    es_descartable: false,
    requiere_numero_serie: true,
    normativa: 'IRAM 3622',
  },
  {
    nombre: 'Línea vida retráctil',
    categoria_nombre: 'Protección caída altura',
    vida_util_meses: 12,
    es_descartable: false,
    requiere_numero_serie: true,
    normativa: 'IRAM 3605',
  },
  {
    nombre: 'Barbijo N95',
    categoria_nombre: 'Protección respiratoria',
    vida_util_meses: 6,
    es_descartable: true,
    requiere_numero_serie: false,
    normativa: 'NIOSH N95',
  },
  {
    nombre: 'Protector auditivo copa',
    categoria_nombre: 'Protección auditiva',
    vida_util_meses: 6,
    es_descartable: false,
    requiere_numero_serie: false,
    normativa: 'IRAM 4060',
  },
  {
    nombre: 'Protector auditivo endaural',
    categoria_nombre: 'Protección auditiva',
    vida_util_meses: 6,
    es_descartable: true,
    requiere_numero_serie: false,
  },
] as const;

const PUESTOS_DEFAULT: ReadonlyArray<PuestoDefault> = [
  {
    nombre: 'Operario general',
    descripcion: 'Tareas operativas generales',
    riesgos_asociados: ['caida_objetos', 'golpes', 'cortes'],
  },
  {
    nombre: 'Soldador',
    descripcion: 'Soldadura eléctrica/oxiacetilénica',
    riesgos_asociados: ['quemaduras', 'radiacion_uv', 'humos'],
  },
  {
    nombre: 'Conductor maquinaria',
    descripcion: 'Operación de autoelevadores/grúas',
    riesgos_asociados: ['atrapamiento', 'vibraciones', 'ruido'],
  },
] as const;

/**
 * Idempotente: re-invocaciones completan lo que falte sin duplicar. Para
 * cada entidad: SELECT existentes por nombre (sólo activos) → INSERT sólo lo
 * que falta. Más simple y predecible que apoyarse en ON CONFLICT con índices
 * únicos parciales (que PostgREST puede ambiguar).
 *
 * Si la consultora ya tiene catálogo (parcial o completo), el resultado
 * informa cuántas filas NUEVAS creó cada paso. Catálogo intacto → 0/0/0.
 */
export async function seedDefaultCatalogAction(): Promise<SeedResult> {
  const supabase = await createClient();
  const auth = await requireOwner(supabase);
  if (!auth.ok) return auth;

  const consultoraId = auth.ctx.consultoraId;
  const userId = auth.ctx.userId;

  // 1. Categorías — pre-check + insertar las que faltan.
  const { data: existingCategorias, error: catReadErr } = await supabase
    .from('epp_categorias')
    .select('id, nombre')
    .eq('consultora_id', consultoraId)
    .is('archived_at', null);

  if (catReadErr) {
    logger.error(
      { err: catReadErr, userId, consultoraId },
      'seedDefaultCatalogAction: categorias pre-check failed',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Error leyendo categorías existentes.' };
  }

  const existingCategoriaNombres = new Set(
    (existingCategorias ?? []).map((c) => c.nombre.toLowerCase()),
  );

  const categoriasToInsert: CategoriaInsert[] = CATEGORIAS_DEFAULT.filter(
    (c) => !existingCategoriaNombres.has(c.nombre.toLowerCase()),
  ).map((c) => ({
    nombre: c.nombre,
    descripcion: c.descripcion,
    consultora_id: consultoraId,
    created_by: userId,
  }));

  let categoriasCreated = 0;
  if (categoriasToInsert.length > 0) {
    const { data: catInserted, error: catErr } = await supabase
      .from('epp_categorias')
      .insert(categoriasToInsert)
      .select('id');
    if (catErr) {
      logger.error(
        { err: catErr, userId, consultoraId },
        'seedDefaultCatalogAction: categorias insert failed',
      );
      return { ok: false, code: 'INTERNAL_ERROR', message: 'Error creando categorías default.' };
    }
    categoriasCreated = catInserted?.length ?? 0;
  }

  // 2. Re-fetch nombre → id para resolver FK de items (incluye preexistentes).
  const { data: allCategorias, error: catReadAllErr } = await supabase
    .from('epp_categorias')
    .select('id, nombre')
    .eq('consultora_id', consultoraId)
    .is('archived_at', null);

  if (catReadAllErr || !allCategorias) {
    logger.error(
      { err: catReadAllErr, userId, consultoraId },
      'seedDefaultCatalogAction: categorias re-fetch failed',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Error leyendo categorías.' };
  }

  const categoriaIdByNombre = new Map(allCategorias.map((c) => [c.nombre, c.id]));

  // 3. Items — pre-check por (categoria_id, nombre) y insertar los que faltan.
  const { data: existingItems, error: itemReadErr } = await supabase
    .from('epp_items')
    .select('nombre, categoria_id')
    .eq('consultora_id', consultoraId)
    .is('archived_at', null);

  if (itemReadErr) {
    logger.error(
      { err: itemReadErr, userId, consultoraId },
      'seedDefaultCatalogAction: items pre-check failed',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Error leyendo items existentes.' };
  }

  const existingItemKey = new Set(
    (existingItems ?? []).map((i) => `${i.categoria_id}::${i.nombre.toLowerCase()}`),
  );

  const itemsToInsert: ItemInsert[] = [];
  for (const it of ITEMS_DEFAULT) {
    const categoriaId = categoriaIdByNombre.get(it.categoria_nombre);
    if (!categoriaId) continue;
    const key = `${categoriaId}::${it.nombre.toLowerCase()}`;
    if (existingItemKey.has(key)) continue;
    itemsToInsert.push({
      nombre: it.nombre,
      categoria_id: categoriaId,
      vida_util_meses: it.vida_util_meses,
      es_descartable: it.es_descartable,
      requiere_numero_serie: it.requiere_numero_serie,
      normativa: it.normativa,
      consultora_id: consultoraId,
      created_by: userId,
    });
  }

  let itemsCreated = 0;
  if (itemsToInsert.length > 0) {
    const { data: itemInserted, error: itemErr } = await supabase
      .from('epp_items')
      .insert(itemsToInsert)
      .select('id');
    if (itemErr) {
      logger.error(
        { err: itemErr, userId, consultoraId },
        'seedDefaultCatalogAction: items insert failed',
      );
      return { ok: false, code: 'INTERNAL_ERROR', message: 'Error creando items default.' };
    }
    itemsCreated = itemInserted?.length ?? 0;
  }

  // 4. Puestos — pre-check + insertar los que faltan.
  const { data: existingPuestos, error: puestoReadErr } = await supabase
    .from('puestos')
    .select('id, nombre')
    .eq('consultora_id', consultoraId)
    .is('archived_at', null);

  if (puestoReadErr) {
    logger.error(
      { err: puestoReadErr, userId, consultoraId },
      'seedDefaultCatalogAction: puestos pre-check failed',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Error leyendo puestos existentes.' };
  }

  const existingPuestoNombres = new Set((existingPuestos ?? []).map((p) => p.nombre.toLowerCase()));

  const puestosToInsert: PuestoInsert[] = PUESTOS_DEFAULT.filter(
    (p) => !existingPuestoNombres.has(p.nombre.toLowerCase()),
  ).map((p) => ({
    nombre: p.nombre,
    descripcion: p.descripcion,
    riesgos_asociados: p.riesgos_asociados,
    consultora_id: consultoraId,
    created_by: userId,
  }));

  let puestosCreated = 0;
  if (puestosToInsert.length > 0) {
    const { data: puestoInserted, error: puestoErr } = await supabase
      .from('puestos')
      .insert(puestosToInsert)
      .select('id');
    if (puestoErr) {
      logger.error(
        { err: puestoErr, userId, consultoraId },
        'seedDefaultCatalogAction: puestos insert failed',
      );
      return { ok: false, code: 'INTERNAL_ERROR', message: 'Error creando puestos default.' };
    }
    puestosCreated = puestoInserted?.length ?? 0;
  }

  revalidateCatalog();
  logger.info(
    {
      userId,
      consultoraId,
      categoriasCreated,
      itemsCreated,
      puestosCreated,
      action: 'seed_default_catalog',
    },
    'seedDefaultCatalogAction: completed',
  );

  return {
    ok: true,
    created: {
      categorias: categoriasCreated,
      items: itemsCreated,
      puestos: puestosCreated,
    },
  };
}
