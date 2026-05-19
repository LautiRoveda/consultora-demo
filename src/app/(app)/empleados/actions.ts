'use server';

import type { Database } from '@/shared/supabase/types';
import { revalidatePath } from 'next/cache';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { logger } from '@/shared/observability/logger';
import { createClient } from '@/shared/supabase/server';
import { normalizeCuit } from '@/shared/templates/common/cuit';
import { normalizeDni } from '@/shared/templates/common/dni';

import { createEmpleadoSchema, empleadoIdSchema, updateEmpleadoPatchSchema } from './schema';

type EmpleadoUpdate = Database['public']['Tables']['empleados']['Update'];

const RLS_VIOLATION_CODE = '42501';
const UNIQUE_VIOLATION_CODE = '23505';
const CHECK_VIOLATION_CODE = '23514';
const DNI_UNIQUE_INDEX = 'idx_empleados_consultora_cliente_dni';

// ============ Discriminated unions ============

export type CreateEmpleadoResult =
  | { ok: true; empleadoId: string }
  | {
      ok: false;
      code: 'INVALID_INPUT';
      fieldErrors: Record<string, string[]>;
      message: string;
    }
  | {
      ok: false;
      code: 'UNAUTHENTICATED' | 'NO_CONSULTORA' | 'INTERNAL_ERROR';
      message: string;
    }
  | {
      ok: false;
      code: 'CLIENTE_NOT_FOUND_OR_FORBIDDEN';
      fieldErrors: { cliente_id: string[] };
      message: string;
    }
  | {
      ok: false;
      code: 'DUPLICATE_DNI';
      fieldErrors: { dni: string[] };
      message: string;
    };

export type UpdateEmpleadoResult =
  | { ok: true; empleadoId: string }
  | {
      ok: false;
      code: 'INVALID_INPUT';
      fieldErrors: Record<string, string[]>;
      message: string;
    }
  | {
      ok: false;
      code: 'UNAUTHENTICATED' | 'NO_CONSULTORA' | 'NOT_FOUND' | 'INTERNAL_ERROR';
      message: string;
    }
  | {
      ok: false;
      code: 'DUPLICATE_DNI';
      fieldErrors: { dni: string[] };
      message: string;
    };

export type ArchiveEmpleadoResult =
  | { ok: true; empleadoId: string }
  | {
      ok: false;
      code: 'INVALID_INPUT';
      fieldErrors: Record<string, string[]>;
      message: string;
    }
  | {
      ok: false;
      code:
        | 'UNAUTHENTICATED'
        | 'NO_CONSULTORA'
        | 'NOT_FOUND'
        | 'ALREADY_ARCHIVED'
        | 'INTERNAL_ERROR';
      message: string;
    };

export type UnarchiveEmpleadoResult =
  | { ok: true; empleadoId: string }
  | {
      ok: false;
      code: 'INVALID_INPUT';
      fieldErrors: Record<string, string[]>;
      message: string;
    }
  | {
      ok: false;
      code: 'UNAUTHENTICATED' | 'NO_CONSULTORA' | 'NOT_FOUND' | 'ALREADY_ACTIVE' | 'INTERNAL_ERROR';
      message: string;
    }
  | {
      ok: false;
      code: 'DUPLICATE_DNI';
      fieldErrors: { dni: string[] };
      message: string;
    };

// ============ Helpers ============

function buildInvalidInput(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): { fieldErrors: Record<string, string[]> } {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.map((p) => String(p)).join('.') || '_';
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return { fieldErrors };
}

function isDniUniqueViolation(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code !== UNIQUE_VIOLATION_CODE) return false;
  return (err.message ?? '').includes(DNI_UNIQUE_INDEX);
}

// ============ Actions ============

export async function createEmpleadoAction(input: unknown): Promise<CreateEmpleadoResult> {
  const parsed = createEmpleadoSchema.safeParse(input);
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      code: 'UNAUTHENTICATED',
      message: 'Necesitás iniciar sesión.',
    };
  }

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    logger.warn({ userId: user.id }, 'createEmpleadoAction: user without consultora membership');
    return {
      ok: false,
      code: 'NO_CONSULTORA',
      message: 'No tenés una consultora asociada.',
    };
  }

  // Cross-tenant defense (lesson T-050): FK constraint valida existencia pero
  // NO respeta RLS — atacante podría INSERT con cliente_id de otro tenant.
  // SELECT RLS-aware filtra a null si el cliente no pertenece al tenant.
  const { data: cliente } = await supabase
    .from('clientes')
    .select('id')
    .eq('id', parsed.data.cliente_id)
    .maybeSingle();
  if (!cliente) {
    logger.warn(
      { userId: user.id, consultoraId: consultora.id, clienteId: parsed.data.cliente_id },
      'createEmpleadoAction: cliente_id not found or cross-tenant',
    );
    return {
      ok: false,
      code: 'CLIENTE_NOT_FOUND_OR_FORBIDDEN',
      fieldErrors: { cliente_id: ['Cliente no encontrado.'] },
      message: 'El cliente seleccionado no existe.',
    };
  }

  const normalizedDni = normalizeDni(parsed.data.dni);
  const normalizedCuil =
    typeof parsed.data.cuil === 'string' ? normalizeCuit(parsed.data.cuil) : undefined;

  const { data, error } = await supabase
    .from('empleados')
    .insert({
      ...parsed.data,
      dni: normalizedDni,
      ...(normalizedCuil !== undefined ? { cuil: normalizedCuil } : {}),
      consultora_id: consultora.id,
      created_by: user.id,
    })
    .select('id')
    .single();

  if (isDniUniqueViolation(error)) {
    return {
      ok: false,
      code: 'DUPLICATE_DNI',
      fieldErrors: { dni: ['Ya existe un empleado activo con este DNI en este cliente.'] },
      message: `Ya existe un empleado activo con DNI ${normalizedDni} en este cliente. Si lo reemplazás, archivá el anterior primero.`,
    };
  }

  if (error?.code === RLS_VIOLATION_CODE) {
    logger.warn(
      { userId: user.id, consultoraId: consultora.id, err: error.message },
      'createEmpleadoAction: RLS rejected insert (drift — any-member gate expected)',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'No se pudo crear el empleado. Reintentá en unos minutos.',
    };
  }

  if (error?.code === CHECK_VIOLATION_CODE) {
    logger.warn(
      { userId: user.id, consultoraId: consultora.id, err: error.message },
      'createEmpleadoAction: SQL CHECK violation (drift Zod-vs-SQL)',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Algún campo no cumple las restricciones. Revisá el formulario.',
    };
  }

  if (error || !data) {
    logger.error(
      { err: error, userId: user.id, consultoraId: consultora.id },
      'createEmpleadoAction: insert failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Hubo un error creando el empleado. Reintentá en unos minutos.',
    };
  }

  revalidatePath('/empleados');
  revalidatePath(`/clientes/${parsed.data.cliente_id}`);
  logger.info(
    {
      empleadoId: data.id,
      userId: user.id,
      consultoraId: consultora.id,
      clienteId: parsed.data.cliente_id,
      action: 'create_empleado',
    },
    'createEmpleadoAction: created',
  );
  return { ok: true, empleadoId: data.id };
}

export async function updateEmpleadoAction(
  id: unknown,
  patch: unknown,
): Promise<UpdateEmpleadoResult> {
  const idParsed = empleadoIdSchema.safeParse(id);
  if (!idParsed.success) {
    const { fieldErrors } = buildInvalidInput(idParsed.error.issues);
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors,
      message: 'ID inválido.',
    };
  }

  const patchParsed = updateEmpleadoPatchSchema.safeParse(patch);
  if (!patchParsed.success) {
    const { fieldErrors } = buildInvalidInput(patchParsed.error.issues);
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors,
      message: 'Revisá los campos del formulario.',
    };
  }

  const empleadoId = idParsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      code: 'UNAUTHENTICATED',
      message: 'Necesitás iniciar sesión.',
    };
  }

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    return {
      ok: false,
      code: 'NO_CONSULTORA',
      message: 'No tenés una consultora asociada.',
    };
  }

  // SELECT defensivo — RLS filtra cross-tenant a null automáticamente.
  // Traemos cliente_id para poder revalidatePath('/clientes/${cliente_id}').
  const { data: existing } = await supabase
    .from('empleados')
    .select('id, cliente_id')
    .eq('id', empleadoId)
    .maybeSingle();
  if (!existing) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'Empleado no encontrado.',
    };
  }

  const payload: EmpleadoUpdate = { ...patchParsed.data };
  if (typeof payload.dni === 'string') {
    payload.dni = normalizeDni(payload.dni);
  }
  if (typeof payload.cuil === 'string') {
    payload.cuil = normalizeCuit(payload.cuil);
  }

  const { data, error } = await supabase
    .from('empleados')
    .update(payload)
    .eq('id', empleadoId)
    .select('id')
    .single();

  if (isDniUniqueViolation(error)) {
    const newDni = typeof payload.dni === 'string' ? payload.dni : 'el DNI enviado';
    return {
      ok: false,
      code: 'DUPLICATE_DNI',
      fieldErrors: { dni: ['Ya existe un empleado activo con este DNI en este cliente.'] },
      message: `Ya existe un empleado activo con DNI ${newDni} en este cliente. Si lo reemplazás, archivá el anterior primero.`,
    };
  }

  if (error?.code === RLS_VIOLATION_CODE) {
    logger.warn(
      { userId: user.id, consultoraId: consultora.id, empleadoId, err: error.message },
      'updateEmpleadoAction: RLS rejected update (drift — any-member gate expected)',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'No se pudo actualizar el empleado. Reintentá en unos minutos.',
    };
  }

  if (error?.code === CHECK_VIOLATION_CODE) {
    logger.warn(
      { userId: user.id, consultoraId: consultora.id, empleadoId, err: error.message },
      'updateEmpleadoAction: SQL CHECK violation (drift Zod-vs-SQL)',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Algún campo no cumple las restricciones. Revisá el formulario.',
    };
  }

  if (error || !data) {
    logger.error(
      { err: error, userId: user.id, consultoraId: consultora.id, empleadoId },
      'updateEmpleadoAction: update failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Hubo un error actualizando el empleado. Reintentá en unos minutos.',
    };
  }

  revalidatePath('/empleados');
  revalidatePath(`/empleados/${empleadoId}`);
  revalidatePath(`/clientes/${existing.cliente_id}`);
  logger.info(
    {
      empleadoId,
      userId: user.id,
      consultoraId: consultora.id,
      clienteId: existing.cliente_id,
      action: 'update_empleado',
    },
    'updateEmpleadoAction: updated',
  );
  return { ok: true, empleadoId };
}

export async function archiveEmpleadoAction(id: unknown): Promise<ArchiveEmpleadoResult> {
  const idParsed = empleadoIdSchema.safeParse(id);
  if (!idParsed.success) {
    const { fieldErrors } = buildInvalidInput(idParsed.error.issues);
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors,
      message: 'ID inválido.',
    };
  }

  const empleadoId = idParsed.data;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      code: 'UNAUTHENTICATED',
      message: 'Necesitás iniciar sesión.',
    };
  }

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    return {
      ok: false,
      code: 'NO_CONSULTORA',
      message: 'No tenés una consultora asociada.',
    };
  }

  const { data: existing } = await supabase
    .from('empleados')
    .select('id, archived_at, cliente_id')
    .eq('id', empleadoId)
    .maybeSingle();
  if (!existing) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'Empleado no encontrado.',
    };
  }

  if (existing.archived_at !== null) {
    return {
      ok: false,
      code: 'ALREADY_ARCHIVED',
      message: 'El empleado ya estaba archivado.',
    };
  }

  const { data, error } = await supabase
    .from('empleados')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', empleadoId)
    .select('id')
    .single();

  if (error || !data) {
    logger.error(
      { err: error, userId: user.id, consultoraId: consultora.id, empleadoId },
      'archiveEmpleadoAction: archive failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Hubo un error archivando el empleado. Reintentá en unos minutos.',
    };
  }

  revalidatePath('/empleados');
  revalidatePath(`/empleados/${empleadoId}`);
  revalidatePath(`/clientes/${existing.cliente_id}`);
  logger.info(
    {
      empleadoId,
      userId: user.id,
      consultoraId: consultora.id,
      clienteId: existing.cliente_id,
      action: 'archive_empleado',
    },
    'archiveEmpleadoAction: archived',
  );
  return { ok: true, empleadoId };
}

export async function unarchiveEmpleadoAction(id: unknown): Promise<UnarchiveEmpleadoResult> {
  const idParsed = empleadoIdSchema.safeParse(id);
  if (!idParsed.success) {
    const { fieldErrors } = buildInvalidInput(idParsed.error.issues);
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors,
      message: 'ID inválido.',
    };
  }

  const empleadoId = idParsed.data;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      code: 'UNAUTHENTICATED',
      message: 'Necesitás iniciar sesión.',
    };
  }

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    return {
      ok: false,
      code: 'NO_CONSULTORA',
      message: 'No tenés una consultora asociada.',
    };
  }

  const { data: existing } = await supabase
    .from('empleados')
    .select('id, archived_at, cliente_id')
    .eq('id', empleadoId)
    .maybeSingle();
  if (!existing) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'Empleado no encontrado.',
    };
  }

  if (existing.archived_at === null) {
    return {
      ok: false,
      code: 'ALREADY_ACTIVE',
      message: 'El empleado ya estaba activo.',
    };
  }

  const { data, error } = await supabase
    .from('empleados')
    .update({ archived_at: null })
    .eq('id', empleadoId)
    .select('id')
    .single();

  // Edge case: empleado A archivado, otro user creó empleado B con mismo DNI
  // activo en el mismo cliente (válido porque A estaba archivado). Ahora
  // intenta unarchive de A → UNIQUE partial WHERE archived_at IS NULL viola con 23505.
  if (isDniUniqueViolation(error)) {
    return {
      ok: false,
      code: 'DUPLICATE_DNI',
      fieldErrors: { dni: ['Existe otro empleado activo con este DNI en este cliente.'] },
      message:
        'No podés desarchivar este empleado: ya existe otro empleado activo con el mismo DNI en este cliente. Archivá el otro primero.',
    };
  }

  if (error || !data) {
    logger.error(
      { err: error, userId: user.id, consultoraId: consultora.id, empleadoId },
      'unarchiveEmpleadoAction: unarchive failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Hubo un error desarchivando el empleado. Reintentá en unos minutos.',
    };
  }

  revalidatePath('/empleados');
  revalidatePath(`/empleados/${empleadoId}`);
  revalidatePath(`/clientes/${existing.cliente_id}`);
  logger.info(
    {
      empleadoId,
      userId: user.id,
      consultoraId: consultora.id,
      clienteId: existing.cliente_id,
      action: 'unarchive_empleado',
    },
    'unarchiveEmpleadoAction: unarchived',
  );
  return { ok: true, empleadoId };
}
