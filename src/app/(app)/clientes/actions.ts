'use server';

import type { AccessFailure } from '@/shared/auth/with-billing';
import type { Database } from '@/shared/supabase/types';
import type { ClienteSummary } from './queries';
import { revalidatePath } from 'next/cache';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { requireMemberWithBilling } from '@/shared/auth/with-billing';
import { logger } from '@/shared/observability/logger';
import { createClient } from '@/shared/supabase/server';
import { normalizeCuit } from '@/shared/templates/common/cuit';

import { searchClientesByRazonSocial } from './queries';
import { clienteIdSchema, createClienteSchema, updateClientePatchSchema } from './schema';

type ClienteUpdate = Database['public']['Tables']['clientes']['Update'];

const RLS_VIOLATION_CODE = '42501';
const UNIQUE_VIOLATION_CODE = '23505';
const CHECK_VIOLATION_CODE = '23514';
const CUIT_UNIQUE_INDEX = 'idx_clientes_consultora_cuit';

// ============ Discriminated unions ============

export type CreateClienteResult =
  | { ok: true; clienteId: string }
  | {
      ok: false;
      code: 'INVALID_INPUT';
      fieldErrors: Record<string, string[]>;
      message: string;
    }
  | {
      ok: false;
      code: 'DUPLICATE_CUIT';
      fieldErrors: { cuit: string[] };
      message: string;
    }
  // T-115: AccessFailure cubre UNAUTHENTICATED | NO_CONSULTORA | FORBIDDEN_NOT_OWNER
  // | INTERNAL_ERROR | BILLING_GATED. El INTERNAL_ERROR de dominio (insert fallido)
  // comparte shape, así que sigue tipando.
  | AccessFailure;

export type UpdateClienteResult =
  | { ok: true; clienteId: string }
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
      code: 'DUPLICATE_CUIT';
      fieldErrors: { cuit: string[] };
      message: string;
    };

export type ArchiveClienteResult =
  | { ok: true; clienteId: string }
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

export type UnarchiveClienteResult =
  | { ok: true; clienteId: string }
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
      code: 'DUPLICATE_CUIT';
      fieldErrors: { cuit: string[] };
      message: string;
    };

// ============ Helper ============

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

function isCuitUniqueViolation(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code !== UNIQUE_VIOLATION_CODE) return false;
  return (err.message ?? '').includes(CUIT_UNIQUE_INDEX);
}

// ============ Actions ============

export async function createClienteAction(input: unknown): Promise<CreateClienteResult> {
  const parsed = createClienteSchema.safeParse(input);
  if (!parsed.success) {
    const { fieldErrors } = buildInvalidInput(parsed.error.issues);
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors,
      message: 'Revisá los campos del formulario.',
    };
  }

  // T-073 · Trial gate (member gate). T-115: `requireMemberWithBilling` envuelve
  // el billing en try/catch → INTERNAL_ERROR de dominio, no un reject sin manejar.
  const supabase = await createClient();
  const access = await requireMemberWithBilling(supabase);
  if (!access.ok) return access;
  const { userId, consultoraId } = access.ctx;

  const normalizedCuit = normalizeCuit(parsed.data.cuit);

  const { data, error } = await supabase
    .from('clientes')
    .insert({
      ...parsed.data,
      cuit: normalizedCuit,
      consultora_id: consultoraId,
      created_by: userId,
    })
    .select('id')
    .single();

  if (isCuitUniqueViolation(error)) {
    return {
      ok: false,
      code: 'DUPLICATE_CUIT',
      fieldErrors: { cuit: ['Ya existe un cliente activo con este CUIT.'] },
      message: `Ya existe un cliente activo con CUIT ${normalizedCuit}. Si lo reemplazás, archivá el anterior primero.`,
    };
  }

  if (error?.code === RLS_VIOLATION_CODE) {
    logger.warn(
      { userId, consultoraId, err: error.message },
      'createClienteAction: RLS rejected insert (drift — any-member gate expected)',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'No se pudo crear el cliente. Reintentá en unos minutos.',
    };
  }

  if (error?.code === CHECK_VIOLATION_CODE) {
    logger.warn(
      { userId, consultoraId, err: error.message },
      'createClienteAction: SQL CHECK violation (drift Zod-vs-SQL)',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Algún campo no cumple las restricciones. Revisá el formulario.',
    };
  }

  if (error || !data) {
    logger.error({ err: error, userId, consultoraId }, 'createClienteAction: insert failed');
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Hubo un error creando el cliente. Reintentá en unos minutos.',
    };
  }

  revalidatePath('/clientes');
  logger.info(
    {
      clienteId: data.id,
      userId,
      consultoraId,
      action: 'create_cliente',
    },
    'createClienteAction: created',
  );
  return { ok: true, clienteId: data.id };
}

export async function updateClienteAction(
  id: unknown,
  patch: unknown,
): Promise<UpdateClienteResult> {
  const idParsed = clienteIdSchema.safeParse(id);
  if (!idParsed.success) {
    const { fieldErrors } = buildInvalidInput(idParsed.error.issues);
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors,
      message: 'ID inválido.',
    };
  }

  const patchParsed = updateClientePatchSchema.safeParse(patch);
  if (!patchParsed.success) {
    const { fieldErrors } = buildInvalidInput(patchParsed.error.issues);
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors,
      message: 'Revisá los campos del formulario.',
    };
  }

  const clienteId = idParsed.data;

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
  const { data: existing } = await supabase
    .from('clientes')
    .select('id')
    .eq('id', clienteId)
    .maybeSingle();
  if (!existing) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'Cliente no encontrado.',
    };
  }

  const payload: ClienteUpdate = { ...patchParsed.data };
  if (typeof payload.cuit === 'string') {
    payload.cuit = normalizeCuit(payload.cuit);
  }

  const { data, error } = await supabase
    .from('clientes')
    .update(payload)
    .eq('id', clienteId)
    .select('id')
    .single();

  if (isCuitUniqueViolation(error)) {
    const newCuit = typeof payload.cuit === 'string' ? payload.cuit : 'el CUIT enviado';
    return {
      ok: false,
      code: 'DUPLICATE_CUIT',
      fieldErrors: { cuit: ['Ya existe un cliente activo con este CUIT.'] },
      message: `Ya existe un cliente activo con CUIT ${newCuit}. Si lo reemplazás, archivá el anterior primero.`,
    };
  }

  if (error?.code === RLS_VIOLATION_CODE) {
    logger.warn(
      { userId: user.id, consultoraId: consultora.id, clienteId, err: error.message },
      'updateClienteAction: RLS rejected update (drift — any-member gate expected)',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'No se pudo actualizar el cliente. Reintentá en unos minutos.',
    };
  }

  if (error?.code === CHECK_VIOLATION_CODE) {
    logger.warn(
      { userId: user.id, consultoraId: consultora.id, clienteId, err: error.message },
      'updateClienteAction: SQL CHECK violation (drift Zod-vs-SQL)',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Algún campo no cumple las restricciones. Revisá el formulario.',
    };
  }

  if (error || !data) {
    logger.error(
      { err: error, userId: user.id, consultoraId: consultora.id, clienteId },
      'updateClienteAction: update failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Hubo un error actualizando el cliente. Reintentá en unos minutos.',
    };
  }

  revalidatePath('/clientes');
  revalidatePath(`/clientes/${clienteId}`);
  logger.info(
    {
      clienteId,
      userId: user.id,
      consultoraId: consultora.id,
      action: 'update_cliente',
    },
    'updateClienteAction: updated',
  );
  return { ok: true, clienteId };
}

export async function archiveClienteAction(id: unknown): Promise<ArchiveClienteResult> {
  const idParsed = clienteIdSchema.safeParse(id);
  if (!idParsed.success) {
    const { fieldErrors } = buildInvalidInput(idParsed.error.issues);
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors,
      message: 'ID inválido.',
    };
  }

  const clienteId = idParsed.data;
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
    .from('clientes')
    .select('id, archived_at')
    .eq('id', clienteId)
    .maybeSingle();
  if (!existing) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'Cliente no encontrado.',
    };
  }

  if (existing.archived_at !== null) {
    return {
      ok: false,
      code: 'ALREADY_ARCHIVED',
      message: 'El cliente ya estaba archivado.',
    };
  }

  const { data, error } = await supabase
    .from('clientes')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', clienteId)
    .select('id')
    .single();

  if (error || !data) {
    logger.error(
      { err: error, userId: user.id, consultoraId: consultora.id, clienteId },
      'archiveClienteAction: archive failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Hubo un error archivando el cliente. Reintentá en unos minutos.',
    };
  }

  revalidatePath('/clientes');
  revalidatePath(`/clientes/${clienteId}`);
  logger.info(
    {
      clienteId,
      userId: user.id,
      consultoraId: consultora.id,
      action: 'archive_cliente',
    },
    'archiveClienteAction: archived',
  );
  return { ok: true, clienteId };
}

export async function unarchiveClienteAction(id: unknown): Promise<UnarchiveClienteResult> {
  const idParsed = clienteIdSchema.safeParse(id);
  if (!idParsed.success) {
    const { fieldErrors } = buildInvalidInput(idParsed.error.issues);
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors,
      message: 'ID inválido.',
    };
  }

  const clienteId = idParsed.data;
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
    .from('clientes')
    .select('id, archived_at')
    .eq('id', clienteId)
    .maybeSingle();
  if (!existing) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'Cliente no encontrado.',
    };
  }

  if (existing.archived_at === null) {
    return {
      ok: false,
      code: 'ALREADY_ACTIVE',
      message: 'El cliente ya estaba activo.',
    };
  }

  const { data, error } = await supabase
    .from('clientes')
    .update({ archived_at: null })
    .eq('id', clienteId)
    .select('id')
    .single();

  // Edge case: user archivó cliente A, mientras tanto creó cliente B con mismo
  // CUIT (válido porque A estaba archivado). Ahora intenta unarchive de A →
  // UNIQUE partial `WHERE archived_at IS NULL` viola con 23505.
  if (isCuitUniqueViolation(error)) {
    return {
      ok: false,
      code: 'DUPLICATE_CUIT',
      fieldErrors: { cuit: ['Existe otro cliente activo con este CUIT.'] },
      message:
        'No podés desarchivar este cliente: ya existe otro cliente activo con el mismo CUIT. Archivá el otro primero.',
    };
  }

  if (error || !data) {
    logger.error(
      { err: error, userId: user.id, consultoraId: consultora.id, clienteId },
      'unarchiveClienteAction: unarchive failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Hubo un error desarchivando el cliente. Reintentá en unos minutos.',
    };
  }

  revalidatePath('/clientes');
  revalidatePath(`/clientes/${clienteId}`);
  logger.info(
    {
      clienteId,
      userId: user.id,
      consultoraId: consultora.id,
      action: 'unarchive_cliente',
    },
    'unarchiveClienteAction: unarchived',
  );
  return { ok: true, clienteId };
}

// ============ T-050 · searchClientesAction (wrapper RSC) ============

export type SearchClientesResult =
  | { ok: true; results: ClienteSummary[] }
  | {
      ok: false;
      code: 'UNAUTHENTICATED' | 'NO_CONSULTORA' | 'INTERNAL_ERROR';
      message: string;
    };

/**
 * T-050 · Wrapper RSC para `searchClientesByRazonSocial` (queries.ts es
 * `server-only` y no expone funciones invocables desde Client Components).
 *
 * Patrón: discriminated union (consistente con resto del módulo), NUNCA tira.
 * El query helper hace cap min-2-chars + escape wildcards + limit 10 — esta
 * action solo agrega la verificación de sesión + consultora.
 */
export async function searchClientesAction(q: unknown): Promise<SearchClientesResult> {
  const qStr = typeof q === 'string' ? q : '';

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      code: 'UNAUTHENTICATED',
      message: 'Iniciá sesión.',
    };
  }

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    return {
      ok: false,
      code: 'NO_CONSULTORA',
      message: 'Necesitás pertenecer a una consultora.',
    };
  }

  try {
    const results = await searchClientesByRazonSocial(supabase, qStr);
    return { ok: true, results };
  } catch (err) {
    logger.error(
      { err, userId: user.id, consultoraId: consultora.id },
      'searchClientesAction: failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Error buscando clientes.',
    };
  }
}
