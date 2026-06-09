'use server';

import { revalidatePath } from 'next/cache';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { logger } from '@/shared/observability/logger';
import { createClient } from '@/shared/supabase/server';

import { resolveActivePuestoForTenant } from './puesto-lookup';
import { assignPuestoSchema, removePuestoSchema } from './schema';

const UNIQUE_VIOLATION_CODE = '23505';

// ============ Discriminated unions ============

export type AssignPuestoResult =
  | { ok: true }
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
        | 'EMPLEADO_NOT_FOUND'
        | 'PUESTO_NOT_FOUND'
        | 'INTERNAL_ERROR';
      message: string;
    };

export type RemovePuestoResult =
  | { ok: true }
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

// ============ Actions ============

/**
 * Asigna un puesto del catálogo a un empleado. Idempotente: si la asignación
 * ya existe (PK compuesta `(empleado_id, puesto_id)` colisiona con 23505),
 * devuelve `ok: true` silencioso — UX consistente sin error toast.
 *
 * Cross-tenant defense (lesson T-050): SELECTs RLS-aware de empleado y puesto
 * antes del INSERT. RLS filtra a null si pertenecen a otro tenant — devolvemos
 * `EMPLEADO_NOT_FOUND` / `PUESTO_NOT_FOUND` sin leak. Puesto archivado se
 * trata como NOT_FOUND (no se puede asignar uno descontinuado).
 */
export async function assignPuestoAction(input: unknown): Promise<AssignPuestoResult> {
  const parsed = assignPuestoSchema.safeParse(input);
  if (!parsed.success) {
    const { fieldErrors } = buildInvalidInput(parsed.error.issues);
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors,
      message: 'Datos inválidos.',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, code: 'UNAUTHENTICATED', message: 'Necesitás iniciar sesión.' };
  }

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    return { ok: false, code: 'NO_CONSULTORA', message: 'No tenés una consultora asociada.' };
  }

  const { empleado_id, puesto_id } = parsed.data;

  // Defense cross-tenant — RLS filtra a null si el empleado es de otro tenant.
  const { data: empleado } = await supabase
    .from('empleados')
    .select('id')
    .eq('id', empleado_id)
    .maybeSingle();
  if (!empleado) {
    return { ok: false, code: 'EMPLEADO_NOT_FOUND', message: 'Empleado no encontrado.' };
  }

  // Defense cross-tenant + archivado — no permitir asignar puesto archivado.
  // Helper compartido con las actions de alta/edición de empleado (T-128).
  const puesto = await resolveActivePuestoForTenant(supabase, puesto_id);
  if (!puesto) {
    return { ok: false, code: 'PUESTO_NOT_FOUND', message: 'Puesto no disponible.' };
  }

  const { error } = await supabase.from('empleados_puestos').insert({
    empleado_id,
    puesto_id,
    consultora_id: consultora.id,
    asignado_por: user.id,
  });

  if (error?.code === UNIQUE_VIOLATION_CODE) {
    // Asignación ya existe — idempotente, success silencioso.
    return { ok: true };
  }

  if (error) {
    logger.error(
      { err: error, userId: user.id, consultoraId: consultora.id, empleado_id, puesto_id },
      'assignPuestoAction: insert failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Hubo un error asignando el puesto. Reintentá en unos minutos.',
    };
  }

  revalidatePath(`/empleados/${empleado_id}`);
  logger.info(
    {
      empleado_id,
      puesto_id,
      userId: user.id,
      consultoraId: consultora.id,
      action: 'assign_puesto',
    },
    'assignPuestoAction: assigned',
  );
  return { ok: true };
}

/**
 * Quita la asignación de un puesto a un empleado. `NOT_FOUND` cubre tanto la
 * asignación inexistente como el caso cross-tenant (RLS no devuelve filas).
 */
export async function removePuestoAction(input: unknown): Promise<RemovePuestoResult> {
  const parsed = removePuestoSchema.safeParse(input);
  if (!parsed.success) {
    const { fieldErrors } = buildInvalidInput(parsed.error.issues);
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors,
      message: 'Datos inválidos.',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, code: 'UNAUTHENTICATED', message: 'Necesitás iniciar sesión.' };
  }

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    return { ok: false, code: 'NO_CONSULTORA', message: 'No tenés una consultora asociada.' };
  }

  const { empleado_id, puesto_id } = parsed.data;

  // Defense in depth: condicionamos por consultora_id denormalizado además
  // del filtro RLS. Si la fila pertenece a otro tenant, RLS ya bloquea; el
  // .eq adicional protege ante drift de policies.
  const { data, error } = await supabase
    .from('empleados_puestos')
    .delete()
    .eq('empleado_id', empleado_id)
    .eq('puesto_id', puesto_id)
    .eq('consultora_id', consultora.id)
    .select('empleado_id');

  if (error) {
    logger.error(
      { err: error, userId: user.id, consultoraId: consultora.id, empleado_id, puesto_id },
      'removePuestoAction: delete failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Hubo un error quitando el puesto. Reintentá en unos minutos.',
    };
  }

  if (!data || data.length === 0) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'La asignación no existe.',
    };
  }

  revalidatePath(`/empleados/${empleado_id}`);
  logger.info(
    {
      empleado_id,
      puesto_id,
      userId: user.id,
      consultoraId: consultora.id,
      action: 'remove_puesto',
    },
    'removePuestoAction: removed',
  );
  return { ok: true };
}
