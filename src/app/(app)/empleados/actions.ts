'use server';

import type { AccessFailure } from '@/shared/auth/with-billing';
import type { Database } from '@/shared/supabase/types';
import { revalidatePath } from 'next/cache';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { requireMemberWithBilling } from '@/shared/auth/with-billing';
import { logger } from '@/shared/observability/logger';
import { createClient } from '@/shared/supabase/server';
import { normalizeCuit } from '@/shared/templates/common/cuit';
import { normalizeDni } from '@/shared/templates/common/dni';

import { resolveActivePuestoForTenant } from './[id]/puestos/puesto-lookup';
import { createEmpleadoSchema, empleadoIdSchema, updateEmpleadoPatchSchema } from './schema';

type EmpleadoUpdate = Database['public']['Tables']['empleados']['Update'];

const RLS_VIOLATION_CODE = '42501';
const UNIQUE_VIOLATION_CODE = '23505';
const CHECK_VIOLATION_CODE = '23514';
const DNI_UNIQUE_INDEX = 'idx_empleados_consultora_cliente_dni';

// ============ Discriminated unions ============

// `puestoWarning`: el empleado se creó/editó OK, pero el INSERT al join
// `empleados_puestos` falló (caso raro, transitorio) → el empleado quedó sin el
// puesto asignado. El form avisa con toast.warning y el user puede re-asignar
// desde la ficha. NO es un error fatal — `ok` sigue siendo `true` (T-128).
export type CreateEmpleadoResult =
  | { ok: true; empleadoId: string; puestoWarning?: true }
  | {
      ok: false;
      code: 'INVALID_INPUT';
      fieldErrors: Record<string, string[]>;
      message: string;
    }
  | { ok: false; code: 'INTERNAL_ERROR'; message: string }
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
    }
  | {
      ok: false;
      code: 'PUESTO_NOT_FOUND';
      fieldErrors: { puesto_id: string[] };
      message: string;
    }
  // T-115: AccessFailure cubre UNAUTHENTICATED | NO_CONSULTORA | FORBIDDEN_NOT_OWNER
  // | INTERNAL_ERROR | BILLING_GATED.
  | AccessFailure;

export type UpdateEmpleadoResult =
  | { ok: true; empleadoId: string; puestoWarning?: true }
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
    }
  | {
      ok: false;
      code: 'PUESTO_NOT_FOUND';
      fieldErrors: { puesto_id: string[] };
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
  // T-073 · Trial gate (member gate). T-115: `requireMemberWithBilling` envuelve el
  // billing en try/catch → INTERNAL_ERROR de dominio, no un reject sin manejar.
  const access = await requireMemberWithBilling(supabase);
  if (!access.ok) return access;
  const { userId, consultora } = access.ctx;

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
      { userId, consultoraId: consultora.id, clienteId: parsed.data.cliente_id },
      'createEmpleadoAction: cliente_id not found or cross-tenant',
    );
    return {
      ok: false,
      code: 'CLIENTE_NOT_FOUND_OR_FORBIDDEN',
      fieldErrors: { cliente_id: ['Cliente no encontrado.'] },
      message: 'El cliente seleccionado no existe.',
    };
  }

  // T-128 · `puesto_id` (uuid del catálogo) NO es columna de `empleados` —
  // lo sacamos del spread del INSERT. Si viene, validamos ANTES de crear el
  // empleado (puesto inválido/ajeno/archivado → no creamos orphan); la
  // asignación vive en el join `empleados_puestos` (más abajo).
  const { puesto_id, ...rest } = parsed.data;
  if (puesto_id) {
    const puesto = await resolveActivePuestoForTenant(supabase, puesto_id);
    if (!puesto) {
      return {
        ok: false,
        code: 'PUESTO_NOT_FOUND',
        fieldErrors: { puesto_id: ['El puesto elegido no está disponible.'] },
        message: 'El puesto elegido no está disponible. Actualizá la página y reintentá.',
      };
    }
  }

  const normalizedDni = normalizeDni(rest.dni);
  const normalizedCuil = typeof rest.cuil === 'string' ? normalizeCuit(rest.cuil) : undefined;

  const { data, error } = await supabase
    .from('empleados')
    .insert({
      ...rest,
      dni: normalizedDni,
      ...(normalizedCuil !== undefined ? { cuil: normalizedCuil } : {}),
      consultora_id: consultora.id,
      created_by: userId,
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
      { userId, consultoraId: consultora.id, err: error.message },
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
      { userId, consultoraId: consultora.id, err: error.message },
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
      { err: error, userId, consultoraId: consultora.id },
      'createEmpleadoAction: insert failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Hubo un error creando el empleado. Reintentá en unos minutos.',
    };
  }

  // Join estructurado `empleados_puestos`: la asignación del puesto es un write
  // separado del INSERT del empleado. Falla con prob ~0 (puesto pre-validado
  // activo+tenant, consultora_id del contexto, asignado_por=self, PK fresca). Si
  // igual falla, NO es fatal: el empleado ya existe → ok:true + puestoWarning, y
  // el user re-asigna el puesto desde la ficha (T-128).
  let puestoWarning = false;
  if (puesto_id) {
    const { error: joinError } = await supabase.from('empleados_puestos').insert({
      empleado_id: data.id,
      puesto_id,
      consultora_id: consultora.id,
      asignado_por: userId,
    });
    if (joinError && joinError.code !== UNIQUE_VIOLATION_CODE) {
      logger.error(
        {
          err: joinError,
          userId,
          consultoraId: consultora.id,
          empleadoId: data.id,
          puesto_id,
        },
        'createEmpleadoAction: join insert failed (empleado creado, asignación de puesto pendiente)',
      );
      puestoWarning = true;
    }
  }

  revalidatePath('/empleados');
  revalidatePath(`/clientes/${parsed.data.cliente_id}`);
  logger.info(
    {
      empleadoId: data.id,
      userId,
      consultoraId: consultora.id,
      clienteId: parsed.data.cliente_id,
      action: 'create_empleado',
    },
    'createEmpleadoAction: created',
  );
  return { ok: true, empleadoId: data.id, ...(puestoWarning ? { puestoWarning: true } : {}) };
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

  // T-128 · `puesto_id` (uuid del catálogo) NO es columna de `empleados` —
  // fuera del payload del UPDATE. Decidimos el plan de sync del join
  // `empleados_puestos` ANTES de mutar.
  const { puesto_id, ...rest } = patchParsed.data;
  const payload: EmpleadoUpdate = { ...rest };
  if (typeof payload.dni === 'string') {
    payload.dni = normalizeDni(payload.dni);
  }
  if (typeof payload.cuil === 'string') {
    payload.cuil = normalizeCuit(payload.cuil);
  }

  // El form solo manda `puesto_id` cuando cambió (diffPatch). Espejo single:
  // 0/1 puesto del catálogo → reemplaza el join; ≥2 puestos → read-only (la
  // ficha es la fuente de la gestión multi), no tocamos joins. Re-check
  // server-side defensivo ante página stale.
  type JoinPlan = { action: 'none' } | { action: 'clear' } | { action: 'set'; puestoId: string };
  let joinPlan: JoinPlan = { action: 'none' };
  let asignadosCount = 0;
  if ('puesto_id' in patchParsed.data) {
    const { data: joins } = await supabase
      .from('empleados_puestos')
      .select('puesto_id')
      .eq('empleado_id', empleadoId);
    asignadosCount = joins?.length ?? 0;

    if (asignadosCount >= 2) {
      // read-only ≥2: no tocar joins.
    } else if (puesto_id) {
      const puesto = await resolveActivePuestoForTenant(supabase, puesto_id);
      if (!puesto) {
        return {
          ok: false,
          code: 'PUESTO_NOT_FOUND',
          fieldErrors: { puesto_id: ['El puesto elegido no está disponible.'] },
          message: 'El puesto elegido no está disponible. Actualizá la página y reintentá.',
        };
      }
      joinPlan = { action: 'set', puestoId: puesto.id };
    } else {
      // limpiar (puesto_id === null): quitar la asignación del join.
      joinPlan = { action: 'clear' };
    }
  }

  // UPDATE empleado — solo si hay algo que escribir. Con el selector read-only
  // ≥2 (o un cambio de solo-puesto, que ahora vive en el join) y sin otros
  // cambios, el payload puede quedar vacío.
  if (Object.keys(payload).length > 0) {
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
  }

  // Sync del join (write separado, no-fatal). Para reemplazar: INSERT del nuevo
  // ANTES del DELETE del viejo — así un fallo del insert nunca deja al empleado
  // con 0 joins. 23505 = ya asignado (idempotente).
  let puestoWarning = false;
  if (joinPlan.action === 'set') {
    const { error: joinError } = await supabase.from('empleados_puestos').insert({
      empleado_id: empleadoId,
      puesto_id: joinPlan.puestoId,
      consultora_id: consultora.id,
      asignado_por: user.id,
    });
    if (joinError && joinError.code !== UNIQUE_VIOLATION_CODE) {
      logger.error(
        {
          err: joinError,
          userId: user.id,
          consultoraId: consultora.id,
          empleadoId,
          puesto_id: joinPlan.puestoId,
        },
        'updateEmpleadoAction: join insert failed (asignación de puesto pendiente)',
      );
      puestoWarning = true;
    } else if (asignadosCount === 1) {
      // Reemplazo OK: quitar el puesto previo. Si el delete falla, el empleado
      // queda con 2 joins (nuevo + viejo) — avisamos en vez de silenciarlo.
      const { error: delError } = await supabase
        .from('empleados_puestos')
        .delete()
        .eq('empleado_id', empleadoId)
        .eq('consultora_id', consultora.id)
        .neq('puesto_id', joinPlan.puestoId);
      if (delError) {
        logger.error(
          {
            err: delError,
            userId: user.id,
            consultoraId: consultora.id,
            empleadoId,
            puesto_id: joinPlan.puestoId,
          },
          'updateEmpleadoAction: join replace delete failed (puesto previo residual)',
        );
        puestoWarning = true;
      }
    }
  } else if (joinPlan.action === 'clear' && asignadosCount === 1) {
    const { error: delError } = await supabase
      .from('empleados_puestos')
      .delete()
      .eq('empleado_id', empleadoId)
      .eq('consultora_id', consultora.id);
    if (delError) {
      logger.error(
        { err: delError, userId: user.id, consultoraId: consultora.id, empleadoId },
        'updateEmpleadoAction: join clear failed (asignación residual)',
      );
      puestoWarning = true;
    }
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
  return { ok: true, empleadoId, ...(puestoWarning ? { puestoWarning: true } : {}) };
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
