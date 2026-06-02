'use server';

import type { BillingGateReason } from '@/shared/billing/access';
import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { requireBillingAccess } from '@/shared/billing/access';
import { getGateMessage } from '@/shared/billing/messages';
import { logger } from '@/shared/observability/logger';
import { createClient } from '@/shared/supabase/server';

import { anularIncidenteSchema, corregirIncidenteSchema, createIncidenteSchema } from './schema';

type IncidenteInsert = Database['public']['Tables']['incidentes']['Insert'];

const RLS_VIOLATION_CODE = '42501';
const UNIQUE_VIOLATION_CODE = '23505';
const CHECK_VIOLATION_CODE = '23514';
const CORRIGE_UNIQUE_INDEX = 'uq_incidentes_corrige';

// ============ Discriminated unions ============

export type RegisterIncidenteResult =
  | { ok: true; incidenteId: string }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: Record<string, string[]>; message: string }
  | { ok: false; code: 'CROSS_TENANT_REF'; message: string }
  | { ok: false; code: 'UNAUTHENTICATED' | 'NO_CONSULTORA' | 'INTERNAL_ERROR'; message: string }
  | { ok: false; code: 'BILLING_GATED'; reason: BillingGateReason; message: string };

export type CorregirIncidenteResult =
  | { ok: true; incidenteId: string }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: Record<string, string[]>; message: string }
  | { ok: false; code: 'CROSS_TENANT_REF' | 'NOT_FOUND' | 'ALREADY_CORRECTED'; message: string }
  | { ok: false; code: 'UNAUTHENTICATED' | 'NO_CONSULTORA' | 'INTERNAL_ERROR'; message: string }
  | { ok: false; code: 'BILLING_GATED'; reason: BillingGateReason; message: string };

export type AnularIncidenteResult =
  | { ok: true; incidenteId: string }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: Record<string, string[]>; message: string }
  | { ok: false; code: 'NOT_FOUND' | 'ALREADY_CORRECTED'; message: string }
  | { ok: false; code: 'UNAUTHENTICATED' | 'NO_CONSULTORA' | 'INTERNAL_ERROR'; message: string }
  | { ok: false; code: 'BILLING_GATED'; reason: BillingGateReason; message: string };

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

function isCorrigeUniqueViolation(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code !== UNIQUE_VIOLATION_CODE) return false;
  return (err.message ?? '').includes(CORRIGE_UNIQUE_INDEX);
}

/**
 * Valida que cada FK opcional (cliente / empleado / informe) pertenezca al
 * tenant del actor. La RLS de `incidentes` solo valida el `consultora_id` de la
 * fila — NO impide referenciar un `cliente_id` de otro tenant. Acá hacemos un
 * SELECT RLS-scoped: si la fila no aparece, o es cross-tenant o no existe.
 * Devuelve el nombre del campo ofensor, o `null` si todas las refs son válidas.
 */
async function findCrossTenantRef(
  supabase: SupabaseClient<Database>,
  refs: { cliente_id?: string; empleado_id?: string; informe_id?: string },
): Promise<string | null> {
  if (refs.cliente_id) {
    const { data } = await supabase
      .from('clientes')
      .select('id')
      .eq('id', refs.cliente_id)
      .maybeSingle();
    if (!data) return 'cliente_id';
  }
  if (refs.empleado_id) {
    const { data } = await supabase
      .from('empleados')
      .select('id')
      .eq('id', refs.empleado_id)
      .maybeSingle();
    if (!data) return 'empleado_id';
  }
  if (refs.informe_id) {
    const { data } = await supabase
      .from('informes')
      .select('id')
      .eq('id', refs.informe_id)
      .maybeSingle();
    if (!data) return 'informe_id';
  }
  return null;
}

// ============ Actions ============

export async function registerIncidenteAction(input: unknown): Promise<RegisterIncidenteResult> {
  const parsed = createIncidenteSchema.safeParse(input);
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
    return { ok: false, code: 'UNAUTHENTICATED', message: 'Necesitás iniciar sesión.' };
  }

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    logger.warn({ userId: user.id }, 'registerIncidenteAction: user without consultora membership');
    return { ok: false, code: 'NO_CONSULTORA', message: 'No tenés una consultora asociada.' };
  }

  const billing = await requireBillingAccess(supabase, consultora);
  if (!billing.ok) {
    logger.info(
      { userId: user.id, consultoraId: consultora.id, reason: billing.reason },
      'registerIncidenteAction: billing gated',
    );
    return {
      ok: false,
      code: 'BILLING_GATED',
      reason: billing.reason,
      message: getGateMessage(billing.reason),
    };
  }

  const crossRef = await findCrossTenantRef(supabase, parsed.data);
  if (crossRef) {
    logger.warn(
      { userId: user.id, consultoraId: consultora.id, crossRef },
      'registerIncidenteAction: cross-tenant ref rejected',
    );
    return {
      ok: false,
      code: 'CROSS_TENANT_REF',
      message: 'Alguna referencia (cliente, empleado o informe) no pertenece a tu consultora.',
    };
  }

  const { data, error } = await supabase
    .from('incidentes')
    .insert({ ...parsed.data, consultora_id: consultora.id, created_by: user.id })
    .select('id')
    .single();

  if (error?.code === CHECK_VIOLATION_CODE) {
    logger.warn(
      { userId: user.id, consultoraId: consultora.id, err: error.message },
      'registerIncidenteAction: SQL CHECK violation (drift Zod-vs-SQL)',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Algún campo no cumple las restricciones. Revisá el formulario.',
    };
  }

  if (error?.code === RLS_VIOLATION_CODE) {
    logger.warn(
      { userId: user.id, consultoraId: consultora.id, err: error.message },
      'registerIncidenteAction: RLS rejected insert',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'No se pudo registrar el incidente. Reintentá en unos minutos.',
    };
  }

  if (error || !data) {
    logger.error(
      { err: error, userId: user.id, consultoraId: consultora.id },
      'registerIncidenteAction: insert failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Hubo un error registrando el incidente. Reintentá en unos minutos.',
    };
  }

  revalidatePath('/accidentabilidad');
  logger.info(
    {
      incidenteId: data.id,
      userId: user.id,
      consultoraId: consultora.id,
      action: 'register_incidente',
    },
    'registerIncidenteAction: created',
  );
  return { ok: true, incidenteId: data.id };
}

export async function corregirIncidenteAction(input: unknown): Promise<CorregirIncidenteResult> {
  const parsed = corregirIncidenteSchema.safeParse(input);
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
    return { ok: false, code: 'UNAUTHENTICATED', message: 'Necesitás iniciar sesión.' };
  }

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    return { ok: false, code: 'NO_CONSULTORA', message: 'No tenés una consultora asociada.' };
  }

  const billing = await requireBillingAccess(supabase, consultora);
  if (!billing.ok) {
    return {
      ok: false,
      code: 'BILLING_GATED',
      reason: billing.reason,
      message: getGateMessage(billing.reason),
    };
  }

  // El registro a corregir debe existir en el tenant (SELECT RLS-scoped).
  const { data: target } = await supabase
    .from('incidentes')
    .select('id')
    .eq('id', parsed.data.corrige_id)
    .maybeSingle();
  if (!target) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'El incidente que querés corregir no existe o no es de tu consultora.',
    };
  }

  const crossRef = await findCrossTenantRef(supabase, parsed.data);
  if (crossRef) {
    return {
      ok: false,
      code: 'CROSS_TENANT_REF',
      message: 'Alguna referencia (cliente, empleado o informe) no pertenece a tu consultora.',
    };
  }

  const { data, error } = await supabase
    .from('incidentes')
    .insert({ ...parsed.data, consultora_id: consultora.id, created_by: user.id })
    .select('id')
    .single();

  if (isCorrigeUniqueViolation(error)) {
    return {
      ok: false,
      code: 'ALREADY_CORRECTED',
      message: 'Ese incidente ya fue corregido o anulado. Corregí la versión vigente.',
    };
  }

  if (error?.code === CHECK_VIOLATION_CODE) {
    logger.warn(
      { userId: user.id, consultoraId: consultora.id, err: error.message },
      'corregirIncidenteAction: SQL CHECK violation (drift Zod-vs-SQL)',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Algún campo no cumple las restricciones. Revisá el formulario.',
    };
  }

  if (error || !data) {
    logger.error(
      {
        err: error,
        userId: user.id,
        consultoraId: consultora.id,
        corrigeId: parsed.data.corrige_id,
      },
      'corregirIncidenteAction: insert failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Hubo un error corrigiendo el incidente. Reintentá en unos minutos.',
    };
  }

  revalidatePath('/accidentabilidad');
  logger.info(
    {
      incidenteId: data.id,
      corrigeId: parsed.data.corrige_id,
      userId: user.id,
      consultoraId: consultora.id,
      action: 'corregir_incidente',
    },
    'corregirIncidenteAction: corrected',
  );
  return { ok: true, incidenteId: data.id };
}

export async function anularIncidenteAction(input: unknown): Promise<AnularIncidenteResult> {
  const parsed = anularIncidenteSchema.safeParse(input);
  if (!parsed.success) {
    const { fieldErrors } = buildInvalidInput(parsed.error.issues);
    return { ok: false, code: 'INVALID_INPUT', fieldErrors, message: 'Datos inválidos.' };
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

  const billing = await requireBillingAccess(supabase, consultora);
  if (!billing.ok) {
    return {
      ok: false,
      code: 'BILLING_GATED',
      reason: billing.reason,
      message: getGateMessage(billing.reason),
    };
  }

  // Leemos la fila a anular (RLS-scoped → solo de mi tenant). Copiamos los
  // campos que el CHECK tipo<->gravedad exige al tombstone.
  const { data: target } = await supabase
    .from('incidentes')
    .select(
      'tipo, fecha, hora, cliente_id, empleado_id, lugar_especifico, gravedad, dias_perdidos, informe_id',
    )
    .eq('id', parsed.data.id)
    .maybeSingle();
  if (!target) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'El incidente no existe o no es de tu consultora.',
    };
  }

  const tombstone: IncidenteInsert = {
    consultora_id: consultora.id,
    created_by: user.id,
    corrige_id: parsed.data.id,
    anulacion: true,
    tipo: target.tipo,
    fecha: target.fecha,
    hora: target.hora,
    cliente_id: target.cliente_id,
    empleado_id: target.empleado_id,
    lugar_especifico: target.lugar_especifico,
    gravedad: target.gravedad,
    dias_perdidos: target.dias_perdidos,
    informe_id: target.informe_id,
    descripcion: `Anulación: ${parsed.data.motivo}`,
  };

  const { data, error } = await supabase.from('incidentes').insert(tombstone).select('id').single();

  if (isCorrigeUniqueViolation(error)) {
    return {
      ok: false,
      code: 'ALREADY_CORRECTED',
      message: 'Ese incidente ya fue corregido o anulado.',
    };
  }

  if (error || !data) {
    logger.error(
      { err: error, userId: user.id, consultoraId: consultora.id, incidenteId: parsed.data.id },
      'anularIncidenteAction: insert failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Hubo un error anulando el incidente. Reintentá en unos minutos.',
    };
  }

  revalidatePath('/accidentabilidad');
  logger.info(
    {
      incidenteId: data.id,
      anulaId: parsed.data.id,
      userId: user.id,
      consultoraId: consultora.id,
      action: 'anular_incidente',
    },
    'anularIncidenteAction: annulled',
  );
  return { ok: true, incidenteId: data.id };
}
