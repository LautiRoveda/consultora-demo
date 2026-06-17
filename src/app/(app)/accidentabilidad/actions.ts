'use server';

import type { AccessFailure } from '@/shared/auth/with-billing';
import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';

import { requireMemberWithBilling } from '@/shared/auth/with-billing';
import { logger } from '@/shared/observability/logger';
import { createClient } from '@/shared/supabase/server';
import { mapIncidenteToAccidenteMetadata } from '@/shared/templates/accidente/from-incidente';

import { getClienteById } from '../clientes/queries';
import { getEmpleadoPuestosLabel } from '../empleados/queries';
import { createInformeAction } from '../informes/actions';
import { getIncidenteById } from './queries';
import {
  anularIncidenteSchema,
  corregirIncidenteSchema,
  createIncidenteSchema,
  incidenteIdSchema,
} from './schema';

type IncidenteInsert = Database['public']['Tables']['incidentes']['Insert'];

const RLS_VIOLATION_CODE = '42501';
const UNIQUE_VIOLATION_CODE = '23505';
const CHECK_VIOLATION_CODE = '23514';
// PL/pgSQL `no_data_found` (raise ... using errcode='no_data_found' → SQLSTATE P0002).
const NO_DATA_FOUND_CODE = 'P0002';
const CORRIGE_UNIQUE_INDEX = 'uq_incidentes_corrige';

// ============ Discriminated unions ============

export type RegisterIncidenteResult =
  | { ok: true; incidenteId: string }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: Record<string, string[]>; message: string }
  | { ok: false; code: 'CROSS_TENANT_REF'; message: string }
  | { ok: false; code: 'INTERNAL_ERROR'; message: string }
  // T-115: AccessFailure cubre UNAUTHENTICATED | NO_CONSULTORA | FORBIDDEN_NOT_OWNER | INTERNAL_ERROR | BILLING_GATED.
  | AccessFailure;

export type CorregirIncidenteResult =
  | { ok: true; incidenteId: string }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: Record<string, string[]>; message: string }
  | { ok: false; code: 'CROSS_TENANT_REF' | 'NOT_FOUND' | 'ALREADY_CORRECTED'; message: string }
  | { ok: false; code: 'INTERNAL_ERROR'; message: string }
  // T-115: AccessFailure cubre UNAUTHENTICATED | NO_CONSULTORA | FORBIDDEN_NOT_OWNER | INTERNAL_ERROR | BILLING_GATED.
  | AccessFailure;

export type AnularIncidenteResult =
  | { ok: true; incidenteId: string }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: Record<string, string[]>; message: string }
  | { ok: false; code: 'NOT_FOUND' | 'ALREADY_CORRECTED'; message: string }
  | { ok: false; code: 'INTERNAL_ERROR'; message: string }
  // T-115: AccessFailure cubre UNAUTHENTICATED | NO_CONSULTORA | FORBIDDEN_NOT_OWNER | INTERNAL_ERROR | BILLING_GATED.
  | AccessFailure;

export type GenerarInvestigacionIaResult =
  | { ok: true; informeId: string; redirectTo: string }
  // Ya estaba vinculado (o lo vinculó otra pestaña en carrera): el UI navega al
  // informe existente vía `redirectTo`.
  | { ok: false; code: 'ALREADY_LINKED'; message: string; redirectTo: string }
  | {
      ok: false;
      code:
        | 'INVALID_INPUT'
        | 'NOT_FOUND'
        | 'NOT_ACCIDENTE'
        | 'NOT_VIGENTE'
        | 'NO_CLIENTE'
        | 'CROSS_TENANT_REF'
        | 'INTERNAL_ERROR';
      message: string;
    }
  // T-115: AccessFailure cubre UNAUTHENTICATED | NO_CONSULTORA | FORBIDDEN_NOT_OWNER | INTERNAL_ERROR | BILLING_GATED.
  | AccessFailure;

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
  // T-073 · Trial gate (member gate). T-115: `requireMemberWithBilling` envuelve el
  // billing en try/catch → INTERNAL_ERROR de dominio, no un reject sin manejar.
  const access = await requireMemberWithBilling(supabase);
  if (!access.ok) return access;
  const { userId, consultora } = access.ctx;

  const crossRef = await findCrossTenantRef(supabase, parsed.data);
  if (crossRef) {
    logger.warn(
      { userId, consultoraId: consultora.id, crossRef },
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
    .insert({ ...parsed.data, consultora_id: consultora.id, created_by: userId })
    .select('id')
    .single();

  if (error?.code === CHECK_VIOLATION_CODE) {
    logger.warn(
      { userId, consultoraId: consultora.id, err: error.message },
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
      { userId, consultoraId: consultora.id, err: error.message },
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
      { err: error, userId, consultoraId: consultora.id },
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
      userId,
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
  // T-073 · Trial gate (member gate). T-115: `requireMemberWithBilling` envuelve el
  // billing en try/catch → INTERNAL_ERROR de dominio, no un reject sin manejar.
  const access = await requireMemberWithBilling(supabase);
  if (!access.ok) return access;
  const { userId, consultora } = access.ctx;

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
    .insert({ ...parsed.data, consultora_id: consultora.id, created_by: userId })
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
      { userId, consultoraId: consultora.id, err: error.message },
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
        userId,
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
      userId,
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
  // T-073 · Trial gate (member gate). T-115: `requireMemberWithBilling` envuelve el
  // billing en try/catch → INTERNAL_ERROR de dominio, no un reject sin manejar.
  const access = await requireMemberWithBilling(supabase);
  if (!access.ok) return access;
  const { userId, consultora } = access.ctx;

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
    created_by: userId,
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
      { err: error, userId, consultoraId: consultora.id, incidenteId: parsed.data.id },
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
      userId,
      consultoraId: consultora.id,
      action: 'anular_incidente',
    },
    'anularIncidenteAction: annulled',
  );
  return { ok: true, incidenteId: data.id };
}

/**
 * T-075 · "Generar investigación IA": crea un informe `accidente` pre-poblado
 * desde el incidente + su cliente/empleado, lo vincula al incidente (vía la RPC
 * de UPDATE acotado `link_informe_to_incidente`) y devuelve el redirect al editor
 * del informe (donde el usuario revisa los datos y dispara la generación). Reusa
 * `createInformeAction`; NO genera contenido IA acá (coherente con el flujo de
 * informes + el disclaimer "el matriculado revisa y firma").
 *
 * Aplica solo a tipo='accidente' VIGENTE, sin informe ya vinculado y con cliente
 * (razón social/CUIT/domicilio salen del cliente — sin él NO se emite un informe
 * legal con la empresa en blanco → NO_CLIENTE).
 */
export async function generarInvestigacionIaAction(
  incidenteId: unknown,
): Promise<GenerarInvestigacionIaResult> {
  const parsedId = incidenteIdSchema.safeParse(incidenteId);
  if (!parsedId.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Incidente inválido.' };
  }
  const id = parsedId.data;

  const supabase = await createClient();
  // T-073 · Trial gate (member gate). T-115: `requireMemberWithBilling` envuelve el
  // billing en try/catch → INTERNAL_ERROR de dominio, no un reject sin manejar.
  const access = await requireMemberWithBilling(supabase);
  if (!access.ok) return access;
  const { userId, consultora } = access.ctx;

  const result = await getIncidenteById(supabase, id);
  if (!result) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'El incidente no existe o no es de tu consultora.',
    };
  }
  const { incidente, esVigente } = result;

  if (incidente.tipo !== 'accidente') {
    return {
      ok: false,
      code: 'NOT_ACCIDENTE',
      message: 'La investigación IA solo aplica a accidentes con lesión.',
    };
  }
  if (incidente.informe_id) {
    return {
      ok: false,
      code: 'ALREADY_LINKED',
      message: 'Este incidente ya tiene un informe de investigación.',
      redirectTo: `/informes/${incidente.informe_id}`,
    };
  }
  if (!esVigente) {
    return {
      ok: false,
      code: 'NOT_VIGENTE',
      message: 'Solo se puede investigar el registro vigente (no corregido ni anulado).',
    };
  }
  if (!incidente.cliente_id) {
    return {
      ok: false,
      code: 'NO_CLIENTE',
      message: 'Asociá un cliente al incidente para generar la investigación.',
    };
  }

  const cliente = await getClienteById(supabase, incidente.cliente_id);
  if (!cliente) {
    logger.error(
      { incidenteId: id, clienteId: incidente.cliente_id, consultoraId: consultora.id },
      'generarInvestigacionIaAction: cliente no encontrado (RLS/borrado)',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'No se pudo cargar el cliente del incidente. Reintentá en unos minutos.',
    };
  }
  // T-129: el puesto afectado sale de los puestos del catálogo (concatenados),
  // no de la columna legacy `empleados.puesto`.
  const puestoAfectado = incidente.empleado_id
    ? await getEmpleadoPuestosLabel(supabase, incidente.empleado_id)
    : null;

  const { metadata, titulo } = mapIncidenteToAccidenteMetadata({
    incidente,
    cliente,
    puestoAfectado,
  });

  // Reuso de createInformeAction: crea el informe + persiste metadata (no
  // bloqueante) + devuelve redirectTo = /informes/{id}/editar.
  const created = await createInformeAction({
    tipo: 'accidente',
    titulo,
    metadata,
    cliente_id: incidente.cliente_id,
  });
  if (!created.ok) {
    if (created.code === 'BILLING_GATED') {
      return { ok: false, code: 'BILLING_GATED', reason: created.reason, message: created.message };
    }
    logger.error(
      { incidenteId: id, consultoraId: consultora.id, code: created.code },
      'generarInvestigacionIaAction: createInformeAction falló',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'No se pudo crear el informe de investigación. Reintentá en unos minutos.',
    };
  }
  if (!created.metadataPersisted) {
    logger.warn(
      { incidenteId: id, informeId: created.informeId, consultoraId: consultora.id },
      'generarInvestigacionIaAction: metadata no persistida (informe creado vacío, se completa en /editar)',
    );
  }

  // Vincular el incidente al informe — única vía de mutación (append-only sin
  // policy UPDATE). El trigger audita action='linked'.
  const { error: linkError } = await supabase.rpc('link_informe_to_incidente', {
    p_incidente_id: id,
    p_informe_id: created.informeId,
  });
  if (linkError) {
    // Carrera: otra pestaña vinculó primero → releemos el informe ganador.
    if (linkError.code === UNIQUE_VIOLATION_CODE) {
      const after = await getIncidenteById(supabase, id);
      const winnerInformeId = after?.incidente.informe_id ?? created.informeId;
      return {
        ok: false,
        code: 'ALREADY_LINKED',
        message: 'Este incidente ya tiene un informe de investigación.',
        redirectTo: `/informes/${winnerInformeId}`,
      };
    }
    if (linkError.code === CHECK_VIOLATION_CODE) {
      logger.warn(
        {
          incidenteId: id,
          informeId: created.informeId,
          consultoraId: consultora.id,
          err: linkError.message,
        },
        'generarInvestigacionIaAction: link rechazado (no vigente/accidente) — informe huérfano',
      );
      return {
        ok: false,
        code: 'NOT_VIGENTE',
        message: 'El incidente dejó de estar vigente. No se vinculó el informe.',
      };
    }
    if (linkError.code === RLS_VIOLATION_CODE) {
      logger.error(
        { incidenteId: id, informeId: created.informeId, consultoraId: consultora.id },
        'generarInvestigacionIaAction: link forbidden (cross-tenant) — informe huérfano',
      );
      return {
        ok: false,
        code: 'CROSS_TENANT_REF',
        message: 'No se pudo vincular el informe al incidente.',
      };
    }
    if (linkError.code === NO_DATA_FOUND_CODE) {
      return { ok: false, code: 'NOT_FOUND', message: 'El incidente o el informe no se encontró.' };
    }
    logger.error(
      {
        incidenteId: id,
        informeId: created.informeId,
        consultoraId: consultora.id,
        err: linkError.message,
      },
      'generarInvestigacionIaAction: link falló — informe huérfano (revisar para limpieza)',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message:
        'Se creó el informe pero no se pudo vincular al incidente. Reintentá en unos minutos.',
    };
  }

  revalidatePath('/accidentabilidad');
  revalidatePath(`/accidentabilidad/${id}`);
  revalidatePath('/informes');
  logger.info(
    {
      incidenteId: id,
      informeId: created.informeId,
      userId,
      consultoraId: consultora.id,
      action: 'link_investigacion_ia',
    },
    'generarInvestigacionIaAction: linked',
  );
  return { ok: true, informeId: created.informeId, redirectTo: created.redirectTo };
}
