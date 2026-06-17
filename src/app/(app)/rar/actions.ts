'use server';

import type { AccessFailure } from '@/shared/auth/with-billing';
import type { Database } from '@/shared/supabase/types';
import { revalidatePath } from 'next/cache';

import { getClienteById } from '@/app/(app)/clientes/queries';
import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { requireOwner } from '@/shared/auth/requireOwner';
import { requireMemberWithBilling } from '@/shared/auth/with-billing';
import { logger } from '@/shared/observability/logger';
import { createClient } from '@/shared/supabase/server';
import { createServiceRoleClient } from '@/shared/supabase/service-role';

import { resolveActiveAgenteForTenant } from './agente-lookup';
import { AGENTES_658_DEFAULT } from './catalogo-data';
import { listExpuestosByCliente } from './queries';
import {
  assignAgenteSchema,
  createAgenteSchema,
  entityIdSchema,
  presentarRarSchema,
  removeAgenteSchema,
  updateAgentePatchSchema,
} from './schema';

type AgenteInsert = Database['public']['Tables']['rar_agentes']['Insert'];
type AgenteUpdate = Database['public']['Tables']['rar_agentes']['Update'];

const RLS_VIOLATION_CODE = '42501';
const UNIQUE_VIOLATION_CODE = '23505';

type FieldErrors = Record<string, string[]>;

// ============ Discriminated unions ============

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: FieldErrors; message: string }
  | {
      ok: false;
      code: 'UNAUTHENTICATED' | 'NO_CONSULTORA' | 'FORBIDDEN_NOT_OWNER' | 'INTERNAL_ERROR';
      message: string;
    }
  | {
      ok: false;
      code: 'DUPLICATE';
      fieldErrors: { codigo?: string[]; nombre?: string[] };
      message: string;
    };

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
  | {
      ok: false;
      code: 'DUPLICATE';
      fieldErrors: { codigo?: string[]; nombre?: string[] };
      message: string;
    };

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
  | {
      ok: false;
      code: 'DUPLICATE';
      fieldErrors: { codigo?: string[]; nombre?: string[] };
      message: string;
    };

export type SeedResult =
  | { ok: true; created: { agentes: number } }
  | {
      ok: false;
      code: 'UNAUTHENTICATED' | 'NO_CONSULTORA' | 'FORBIDDEN_NOT_OWNER' | 'INTERNAL_ERROR';
      message: string;
    };

export type AssignResult =
  | { ok: true }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: FieldErrors; message: string }
  | {
      ok: false;
      code:
        | 'UNAUTHENTICATED'
        | 'NO_CONSULTORA'
        | 'CLIENTE_NOT_FOUND'
        | 'PUESTO_NOT_FOUND'
        | 'AGENTE_NOT_FOUND'
        | 'INTERNAL_ERROR';
      message: string;
    };

export type RemoveResult =
  | { ok: true }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: FieldErrors; message: string }
  | {
      ok: false;
      code: 'UNAUTHENTICATED' | 'NO_CONSULTORA' | 'NOT_FOUND' | 'INTERNAL_ERROR';
      message: string;
    };

export type PresentarRarResult =
  | { ok: true; presentacionId: string; periodo: number; warnings: string[] }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: FieldErrors; message: string }
  // AccessFailure cubre UNAUTHENTICATED | NO_CONSULTORA | INTERNAL_ERROR | BILLING_GATED.
  | AccessFailure
  | {
      ok: false;
      code: 'CLIENTE_NOT_FOUND' | 'DUPLICATE' | 'INTERNAL_ERROR';
      message: string;
    };

// ============ Helpers ============

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

/** Traduce un 23505 a fieldErrors del campo que colisionó (codigo o nombre). */
function duplicateResult(error: { message?: string } | null): {
  code: 'DUPLICATE';
  ok: false;
  fieldErrors: { codigo?: string[]; nombre?: string[] };
  message: string;
} {
  const msg = error?.message ?? '';
  if (msg.includes('idx_rar_agentes_codigo')) {
    return {
      ok: false,
      code: 'DUPLICATE',
      fieldErrors: { codigo: ['Ya existe un agente activo con ese código.'] },
      message: 'Ya existe un agente activo con ese código.',
    };
  }
  return {
    ok: false,
    code: 'DUPLICATE',
    fieldErrors: { nombre: ['Ya existe un agente activo con ese nombre.'] },
    message: 'Ya existe un agente activo con ese nombre.',
  };
}

function revalidateRar(): void {
  revalidatePath('/rar/agentes');
  revalidatePath('/rar/exposicion');
}

// ============ Catálogo (owner-only) ============

export async function createAgenteAction(input: unknown): Promise<CreateResult> {
  const parsed = createAgenteSchema.safeParse(input);
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

  const payload: AgenteInsert = {
    codigo: parsed.data.codigo,
    nombre: parsed.data.nombre,
    agente_tipo: parsed.data.agente_tipo,
    cas: parsed.data.cas ?? null,
    enfermedad_asociada: parsed.data.enfermedad_asociada ?? null,
    descripcion: parsed.data.descripcion ?? null,
    consultora_id: auth.ctx.consultoraId,
    created_by: auth.ctx.userId,
  };

  const { data, error } = await supabase.from('rar_agentes').insert(payload).select('id').single();

  if (error?.code === UNIQUE_VIOLATION_CODE) {
    return duplicateResult(error);
  }

  if (error || !data) {
    logger.error(
      { err: error, userId: auth.ctx.userId, consultoraId: auth.ctx.consultoraId },
      'createAgenteAction: insert failed',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Hubo un error creando el agente.' };
  }

  revalidateRar();
  logger.info(
    {
      agenteId: data.id,
      userId: auth.ctx.userId,
      consultoraId: auth.ctx.consultoraId,
      action: 'create_rar_agente',
    },
    'createAgenteAction: created',
  );
  return { ok: true, id: data.id };
}

export async function updateAgenteAction(id: unknown, patch: unknown): Promise<UpdateResult> {
  const idParsed = entityIdSchema.safeParse(id);
  if (!idParsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: buildInvalidInput(idParsed.error.issues).fieldErrors,
      message: 'ID inválido.',
    };
  }

  const patchParsed = updateAgentePatchSchema.safeParse(patch);
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
    .from('rar_agentes')
    .select('id')
    .eq('id', idParsed.data)
    .eq('consultora_id', auth.ctx.consultoraId)
    .maybeSingle();
  if (!existing) {
    return { ok: false, code: 'NOT_FOUND', message: 'Agente no encontrado.' };
  }

  const update: AgenteUpdate = patchParsed.data;
  const { data, error } = await supabase
    .from('rar_agentes')
    .update(update)
    .eq('id', idParsed.data)
    .eq('consultora_id', auth.ctx.consultoraId)
    .select('id')
    .single();

  if (error?.code === UNIQUE_VIOLATION_CODE) {
    return duplicateResult(error);
  }

  if (error || !data) {
    logger.error(
      {
        err: error,
        userId: auth.ctx.userId,
        consultoraId: auth.ctx.consultoraId,
        agenteId: idParsed.data,
      },
      'updateAgenteAction: update failed',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Hubo un error actualizando el agente.' };
  }

  revalidateRar();
  return { ok: true, id: data.id };
}

export async function archiveAgenteAction(id: unknown): Promise<ArchiveResult> {
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
    .from('rar_agentes')
    .select('id, archived_at')
    .eq('id', idParsed.data)
    .eq('consultora_id', auth.ctx.consultoraId)
    .maybeSingle();
  if (!existing) {
    return { ok: false, code: 'NOT_FOUND', message: 'Agente no encontrado.' };
  }
  if (existing.archived_at !== null) {
    return { ok: false, code: 'ALREADY_ARCHIVED', message: 'El agente ya estaba archivado.' };
  }

  const { data, error } = await supabase
    .from('rar_agentes')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', idParsed.data)
    .eq('consultora_id', auth.ctx.consultoraId)
    .select('id')
    .single();

  if (error || !data) {
    logger.error(
      {
        err: error,
        userId: auth.ctx.userId,
        consultoraId: auth.ctx.consultoraId,
        agenteId: idParsed.data,
      },
      'archiveAgenteAction: archive failed',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Hubo un error archivando el agente.' };
  }

  revalidateRar();
  return { ok: true, id: data.id };
}

export async function restoreAgenteAction(id: unknown): Promise<RestoreResult> {
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
    .from('rar_agentes')
    .select('id, archived_at')
    .eq('id', idParsed.data)
    .eq('consultora_id', auth.ctx.consultoraId)
    .maybeSingle();
  if (!existing) {
    return { ok: false, code: 'NOT_FOUND', message: 'Agente no encontrado.' };
  }
  if (existing.archived_at === null) {
    return { ok: false, code: 'ALREADY_ACTIVE', message: 'El agente ya estaba activo.' };
  }

  const { data, error } = await supabase
    .from('rar_agentes')
    .update({ archived_at: null })
    .eq('id', idParsed.data)
    .eq('consultora_id', auth.ctx.consultoraId)
    .select('id')
    .single();

  if (error?.code === UNIQUE_VIOLATION_CODE) {
    return duplicateResult(error);
  }

  if (error || !data) {
    logger.error(
      {
        err: error,
        userId: auth.ctx.userId,
        consultoraId: auth.ctx.consultoraId,
        agenteId: idParsed.data,
      },
      'restoreAgenteAction: restore failed',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Hubo un error restaurando el agente.' };
  }

  revalidateRar();
  return { ok: true, id: data.id };
}

/**
 * Siembra el catálogo default (Res SRT 81/2019, Anexo III). Owner-only,
 * idempotente: pre-check de los activos por `codigo` → inserta solo los que
 * faltan (sin ON CONFLICT). Re-invocar no duplica e informa 0 nuevos. Molde
 * `seedDefaultCatalogAction` (epp/catalogo). NO asigna agentes a puestos.
 */
export async function seedDefaultCatalogAction(): Promise<SeedResult> {
  const supabase = await createClient();
  const auth = await requireOwner(supabase);
  if (!auth.ok) return auth;

  const consultoraId = auth.ctx.consultoraId;
  const userId = auth.ctx.userId;

  const { data: existing, error: readErr } = await supabase
    .from('rar_agentes')
    .select('codigo')
    .eq('consultora_id', consultoraId)
    .is('archived_at', null);

  if (readErr) {
    logger.error(
      { err: readErr, userId, consultoraId },
      'seedDefaultCatalogAction: pre-check failed',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Error leyendo agentes existentes.' };
  }

  const existingCodigos = new Set((existing ?? []).map((a) => a.codigo));

  const toInsert: AgenteInsert[] = AGENTES_658_DEFAULT.filter(
    (a) => !existingCodigos.has(a.codigo),
  ).map((a) => ({
    codigo: a.codigo,
    nombre: a.nombre,
    agente_tipo: a.agente_tipo,
    cas: a.cas ?? null,
    enfermedad_asociada: a.enfermedad_asociada ?? null,
    consultora_id: consultoraId,
    created_by: userId,
  }));

  let created = 0;
  if (toInsert.length > 0) {
    const { data: inserted, error: insErr } = await supabase
      .from('rar_agentes')
      .insert(toInsert)
      .select('id');
    if (insErr) {
      logger.error(
        { err: insErr, userId, consultoraId },
        'seedDefaultCatalogAction: insert failed',
      );
      return { ok: false, code: 'INTERNAL_ERROR', message: 'Error creando agentes default.' };
    }
    created = inserted?.length ?? 0;
  }

  revalidateRar();
  logger.info(
    { userId, consultoraId, created, action: 'seed_rar_catalogo' },
    'seedDefaultCatalogAction: completed',
  );
  return { ok: true, created: { agentes: created } };
}

// ============ Exposición (member-level) ============

/**
 * Asigna un agente de riesgo a un puesto. Idempotente: si la asignación ya
 * existe (PK `(puesto_id, agente_id)` → 23505), devuelve `ok: true` silencioso.
 * Cross-tenant defense: SELECT del puesto (RLS-aware) + resolveActiveAgente
 * antes del INSERT.
 */
export async function assignAgenteAPuestoAction(input: unknown): Promise<AssignResult> {
  const parsed = assignAgenteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: buildInvalidInput(parsed.error.issues).fieldErrors,
      message: 'Datos inválidos.',
    };
  }

  const { cliente_id, puesto_id, agente_id } = parsed.data;

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

  // Defense cross-tenant: RLS filtra a null cliente/puesto si son de otro tenant.
  const cliente = await getClienteById(supabase, cliente_id);
  if (!cliente || cliente.archived_at !== null) {
    return { ok: false, code: 'CLIENTE_NOT_FOUND', message: 'Cliente no disponible.' };
  }

  const { data: puesto } = await supabase
    .from('puestos')
    .select('id, archived_at')
    .eq('id', puesto_id)
    .maybeSingle();
  if (!puesto || puesto.archived_at !== null) {
    return { ok: false, code: 'PUESTO_NOT_FOUND', message: 'Puesto no disponible.' };
  }

  const agente = await resolveActiveAgenteForTenant(supabase, agente_id);
  if (!agente) {
    return { ok: false, code: 'AGENTE_NOT_FOUND', message: 'Agente no disponible.' };
  }

  const { error } = await supabase.from('cliente_puesto_agentes').insert({
    cliente_id,
    puesto_id,
    agente_id,
    consultora_id: consultora.id,
    asignado_por: user.id,
  });

  if (error?.code === UNIQUE_VIOLATION_CODE) {
    // Asignación ya existe — idempotente, success silencioso.
    return { ok: true };
  }

  if (error) {
    logger.error(
      { err: error, userId: user.id, consultoraId: consultora.id, puesto_id, agente_id },
      'assignAgenteAPuestoAction: insert failed',
    );
    if (error.code === RLS_VIOLATION_CODE) {
      return { ok: false, code: 'PUESTO_NOT_FOUND', message: 'No se pudo asignar el agente.' };
    }
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Hubo un error asignando el agente. Reintentá en unos minutos.',
    };
  }

  revalidateRar();
  return { ok: true };
}

/**
 * Quita un agente de un puesto. DELETE condicionado por (puesto_id, agente_id,
 * consultora_id) + `.select()` para detectar NOT_FOUND (0 filas).
 */
export async function removeAgenteDePuestoAction(input: unknown): Promise<RemoveResult> {
  const parsed = removeAgenteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: buildInvalidInput(parsed.error.issues).fieldErrors,
      message: 'Datos inválidos.',
    };
  }

  const { cliente_id, puesto_id, agente_id } = parsed.data;

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

  const { data, error } = await supabase
    .from('cliente_puesto_agentes')
    .delete()
    .eq('cliente_id', cliente_id)
    .eq('puesto_id', puesto_id)
    .eq('agente_id', agente_id)
    .eq('consultora_id', consultora.id)
    .select('puesto_id');

  if (error) {
    logger.error(
      { err: error, userId: user.id, consultoraId: consultora.id, puesto_id, agente_id },
      'removeAgenteDePuestoAction: delete failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Hubo un error quitando el agente. Reintentá en unos minutos.',
    };
  }

  if (!data || data.length === 0) {
    return { ok: false, code: 'NOT_FOUND', message: 'La asignación no existe.' };
  }

  revalidateRar();
  return { ok: true };
}

// ============ Presentación (member + billing) ============

/** Suma `months` meses a una fecha ISO YYYY-MM-DD (UTC, sin TZ drift). */
function addMonthsToIsoDate(iso: string, months: number): string {
  const parts = iso.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
}

/**
 * T-146 · Registra una presentación del RAR de un cliente/establecimiento y
 * arma el vencimiento anual `rar_anual` en el calendario (vía RPC service-role
 * `gen_rar_vencimiento_calendar_for`: cierra el ciclo anterior + crea evento +
 * reminders + inserta la presentación inmutable con snapshot legal).
 *
 * `periodo` default = año actual; `fecha_vencimiento` default = hoy + 12 meses
 * (configurable: el RAR vence con el contrato ART). Warnings NO bloqueantes
 * (datos faltantes + cliente sin ART): el matriculado decide presentar igual.
 */
export async function presentarRarAction(input: unknown): Promise<PresentarRarResult> {
  const parsed = presentarRarSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: buildInvalidInput(parsed.error.issues).fieldErrors,
      message: 'Revisá los datos de la presentación.',
    };
  }

  const supabase = await createClient();
  const access = await requireMemberWithBilling(supabase);
  if (!access.ok) return access;
  const { userId, consultoraId } = access.ctx;

  // Cross-tenant defense: RLS filtra a null un cliente de otro tenant.
  const cliente = await getClienteById(supabase, parsed.data.cliente_id);
  if (!cliente || cliente.archived_at !== null) {
    return { ok: false, code: 'CLIENTE_NOT_FOUND', message: 'Cliente no disponible.' };
  }

  // Snapshot legal: header del cliente + nómina (NTE/DAR) congelada al presentar.
  const nomina = await listExpuestosByCliente(supabase, cliente.id);
  const fechaPresentacion = new Date().toISOString().slice(0, 10);
  const periodo = parsed.data.periodo ?? new Date().getUTCFullYear();
  const fechaVencimiento =
    parsed.data.fecha_vencimiento ?? addMonthsToIsoDate(fechaPresentacion, 12);

  const snapshot = {
    cliente: {
      id: cliente.id,
      razon_social: cliente.razon_social,
      cuit: cliente.cuit,
      art: cliente.art,
      domicilio: cliente.domicilio,
      localidad: cliente.localidad,
      provincia: cliente.provincia,
    },
    nomina,
    fecha_presentacion: fechaPresentacion,
    fecha_vencimiento: fechaVencimiento,
    periodo,
    generado_at: new Date().toISOString(),
  };

  // RPC service-role (security definer bypassa RLS; system-generated event).
  const admin = createServiceRoleClient();
  const { data: presentacionId, error } = await admin.rpc('gen_rar_vencimiento_calendar_for', {
    p_consultora_id: consultoraId,
    p_cliente_id: cliente.id,
    p_periodo: periodo,
    p_fecha_presentacion: fechaPresentacion,
    p_fecha_vencimiento: fechaVencimiento,
    p_snapshot: snapshot,
    p_created_by: userId,
  });

  if (error?.code === UNIQUE_VIOLATION_CODE) {
    return {
      ok: false,
      code: 'DUPLICATE',
      message: `Ya registraste la presentación del RAR del período ${periodo} para este cliente.`,
    };
  }

  if (error || !presentacionId) {
    logger.error(
      { err: error, userId, consultoraId, clienteId: cliente.id, periodo },
      'presentarRarAction: rpc failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Hubo un error registrando la presentación. Reintentá en unos minutos.',
    };
  }

  // Warnings NO bloqueantes (la presentación ya se registró).
  const warnings: string[] = [];
  const faltan = nomina.expuestos.filter((e) => e.faltan_datos).length;
  if (faltan > 0) {
    warnings.push(
      `${faltan} trabajador${faltan === 1 ? '' : 'es'} con datos incompletos (CUIL o fecha de ingreso).`,
    );
  }
  if (!cliente.art || cliente.art.trim() === '') {
    warnings.push('El cliente no tiene ART registrada.');
  }

  revalidatePath('/rar/planilla');
  revalidatePath('/calendario');
  logger.info(
    {
      userId,
      consultoraId,
      clienteId: cliente.id,
      periodo,
      presentacionId,
      action: 'presentar_rar',
    },
    'presentarRarAction: registrada',
  );
  return { ok: true, presentacionId, periodo, warnings };
}
