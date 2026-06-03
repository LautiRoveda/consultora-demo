'use server';

import type { AccessFailure } from '@/shared/auth/with-billing';
import type { Database } from '@/shared/supabase/types';
import { revalidatePath } from 'next/cache';

import { requireMemberWithBilling, requireOwnerWithBilling } from '@/shared/auth/with-billing';
import { logger } from '@/shared/observability/logger';
import {
  buildChecklistAdjuntoPath,
  decodeImageDataUrl,
  deleteChecklistAdjunto,
  extForImageMime,
  uploadChecklistAdjunto,
} from '@/shared/storage/checklist-adjuntos';
import {
  buildChecklistFirmaPath,
  deleteChecklistFirma,
  uploadChecklistFirma,
} from '@/shared/storage/checklist-firmas';
import { decodeFirmaDataUrl } from '@/shared/storage/epp-firmas';
import { MAX_ATTACHMENT_SIZE_BYTES, MAX_EPP_FIRMA_SIZE_BYTES } from '@/shared/storage/types';
import { magicBytesMatch } from '@/shared/storage/validators';
import { createClient } from '@/shared/supabase/server';
import { createServiceRoleClient } from '@/shared/supabase/service-role';

import { getClienteById } from '../../clientes/queries';
import { buildCapaRows } from './acciones-capa';
import { computeFirmaPdfHash } from './hash';
import {
  getAdjuntoForDelete,
  getEjecucionBasics,
  getItemBasics,
  getItemsForVersion,
  getPublishedVersionId,
  getRespuestasForExecution,
  respuestaBelongsToExecution,
} from './queries';
import {
  anularEjecucionSchema,
  cerrarEjecucionSchema,
  createEjecucionSchema,
  deleteAdjuntoSchema,
  saveRespuestaSchema,
  uploadAdjuntoSchema,
} from './schema';
import { computeScore, findUnansweredRequired, respuestasByItem } from './scoring';

type ExecutionRespuestaInsert = Database['public']['Tables']['execution_respuestas']['Insert'];

const RLS_VIOLATION_CODE = '42501';
const UNIQUE_VIOLATION_CODE = '23505';

// ============================== Result unions ==============================

type InvalidInput = {
  ok: false;
  code: 'INVALID_INPUT';
  fieldErrors: Record<string, string[]>;
  message: string;
};

type DomainFailure<C extends string> = { ok: false; code: C; message: string };

export type CreateEjecucionResult =
  | { ok: true; executionId: string }
  | InvalidInput
  | AccessFailure
  | DomainFailure<'VERSION_NOT_PUBLISHED' | 'NO_CLIENTE' | 'INTERNAL_ERROR'>;

export type SaveRespuestaResult =
  | { ok: true }
  | InvalidInput
  | AccessFailure
  | DomainFailure<'NOT_FOUND' | 'EXEC_NOT_DRAFT' | 'INTERNAL_ERROR'>;

export type UploadAdjuntoResult =
  | { ok: true; adjuntoId: string; storagePath: string }
  | InvalidInput
  | AccessFailure
  | DomainFailure<'NOT_FOUND' | 'EXEC_NOT_DRAFT' | 'STORAGE_ERROR' | 'INTERNAL_ERROR'>;

export type DeleteAdjuntoResult =
  | { ok: true }
  | InvalidInput
  | AccessFailure
  | DomainFailure<'NOT_FOUND' | 'EXEC_NOT_DRAFT' | 'INTERNAL_ERROR'>;

export type CerrarEjecucionResult =
  | {
      ok: true;
      executionId: string;
      cumplimiento_pct: number | null;
      tiene_criticos_incumplidos: boolean;
      /** CAPAs generadas (1 por "no cumple"). */
      capaCount: number;
      /** Presente si las CAPAs se crearon pero gen_acciones_calendar_for falló (no-fatal). */
      calendarWarning?: string;
    }
  | InvalidInput
  | AccessFailure
  | DomainFailure<
      | 'NOT_FOUND'
      | 'EXEC_NOT_DRAFT'
      | 'ALREADY_CLOSED'
      | 'NO_CLIENTE'
      | 'STORAGE_ERROR'
      | 'INTERNAL_ERROR'
    >
  | {
      ok: false;
      code: 'EXEC_INCOMPLETE';
      faltantes: Array<{ id: string; texto: string }>;
      message: string;
    };

export type AnularEjecucionResult =
  | { ok: true; tombstoneId: string }
  | InvalidInput
  | AccessFailure
  | DomainFailure<'NOT_FOUND' | 'ALREADY_ANULLED' | 'INTERNAL_ERROR'>;

// ============================== Helpers ==============================

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

function invalidInput(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
  message = 'Revisá los campos del formulario.',
): InvalidInput {
  const { fieldErrors } = buildInvalidInput(issues);
  return { ok: false, code: 'INVALID_INPUT', fieldErrors, message };
}

function revalidateEjecucion(executionId?: string): void {
  revalidatePath('/checklists/ejecuciones');
  if (executionId) revalidatePath(`/checklists/ejecuciones/${executionId}`);
}

// ============================== Crear borrador ==============================

export async function createEjecucionAction(input: unknown): Promise<CreateEjecucionResult> {
  const parsed = createEjecucionSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues);

  const supabase = await createClient();
  const pre = await requireMemberWithBilling(supabase);
  if (!pre.ok) return pre;

  const { templateId, clienteId } = parsed.data;

  const versionId = await getPublishedVersionId(supabase, templateId);
  if (!versionId) {
    return {
      ok: false,
      code: 'VERSION_NOT_PUBLISHED',
      message: 'El template no tiene una versión publicada para ejecutar.',
    };
  }

  // Cross-tenant defense: el cliente debe ser visible bajo el JWT (RLS).
  const { data: cliente } = await supabase
    .from('clientes')
    .select('id')
    .eq('id', clienteId)
    .maybeSingle();
  if (!cliente) {
    return {
      ok: false,
      code: 'NO_CLIENTE',
      message: 'El cliente no existe o no es de tu consultora.',
    };
  }

  const executionId = crypto.randomUUID();
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('checklist_executions')
    .insert({
      id: executionId,
      consultora_id: pre.ctx.consultoraId,
      template_version_id: versionId,
      cliente_id: clienteId,
      estado: 'borrador',
      inspector_user_id: pre.ctx.userId,
      fecha_inspeccion: today,
      created_by: pre.ctx.userId,
    })
    .select('id')
    .maybeSingle();

  if (error || !data) {
    logger.error(
      { err: error, templateId, consultoraId: pre.ctx.consultoraId },
      'createEjecucionAction: insert failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'No se pudo crear la inspección. Reintentá en unos minutos.',
    };
  }

  revalidateEjecucion();
  logger.info(
    {
      executionId,
      versionId,
      clienteId,
      userId: pre.ctx.userId,
      consultoraId: pre.ctx.consultoraId,
      action: 'create_ejecucion',
    },
    'createEjecucionAction: created',
  );
  return { ok: true, executionId };
}

// ============================== Auto-save de respuesta ==============================

export async function saveRespuestaAction(input: unknown): Promise<SaveRespuestaResult> {
  const parsed = saveRespuestaSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues);

  const supabase = await createClient();
  const pre = await requireMemberWithBilling(supabase);
  if (!pre.ok) return pre;

  const d = parsed.data;

  const exec = await getEjecucionBasics(supabase, d.executionId);
  if (!exec) return { ok: false, code: 'NOT_FOUND', message: 'Inspección no encontrada.' };
  if (exec.estado !== 'borrador') {
    return { ok: false, code: 'EXEC_NOT_DRAFT', message: 'La inspección ya no es editable.' };
  }

  const item = await getItemBasics(supabase, d.templateItemId);
  if (!item) return { ok: false, code: 'NOT_FOUND', message: 'Ítem no encontrado.' };
  if (item.version_id !== exec.template_version_id) {
    return invalidInput([
      { path: ['templateItemId'], message: 'El ítem no pertenece a esta inspección.' },
    ]);
  }
  if (item.response_type !== d.response_type) {
    return invalidInput([
      {
        path: ['response_type'],
        message: 'El tipo de respuesta no coincide con el ítem. Refrescá la página.',
      },
    ]);
  }

  const payload: ExecutionRespuestaInsert = {
    execution_id: d.executionId,
    template_item_id: d.templateItemId,
    consultora_id: pre.ctx.consultoraId,
    valor: null,
    valor_numerico: null,
    observacion: d.observacion ?? null,
    fecha_regularizacion: null,
  };
  switch (d.response_type) {
    case 'cumple_no_aplica':
      payload.valor = d.valor;
      payload.fecha_regularizacion = d.fecha_regularizacion ?? null;
      break;
    case 'si_no':
    case 'texto':
      payload.valor = d.valor;
      break;
    case 'numerico':
      payload.valor_numerico = d.valor_numerico;
      break;
  }

  const { error } = await supabase
    .from('execution_respuestas')
    .upsert(payload, { onConflict: 'execution_id,template_item_id' });

  if (error?.code === RLS_VIOLATION_CODE) {
    // Carrera: la inspección dejó de ser borrador entre el guard y el UPSERT.
    return { ok: false, code: 'EXEC_NOT_DRAFT', message: 'La inspección ya no es editable.' };
  }
  if (error) {
    logger.error(
      { err: error, executionId: d.executionId, consultoraId: pre.ctx.consultoraId },
      'saveRespuestaAction: upsert failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'No se pudo guardar la respuesta. Reintentá.',
    };
  }

  revalidateEjecucion(d.executionId);
  return { ok: true };
}

// ============================== Adjuntos (fotos) ==============================

export async function uploadAdjuntoAction(input: unknown): Promise<UploadAdjuntoResult> {
  const parsed = uploadAdjuntoSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues);

  const supabase = await createClient();
  const pre = await requireMemberWithBilling(supabase);
  if (!pre.ok) return pre;

  const d = parsed.data;

  const exec = await getEjecucionBasics(supabase, d.executionId);
  if (!exec) return { ok: false, code: 'NOT_FOUND', message: 'Inspección no encontrada.' };
  if (exec.estado !== 'borrador') {
    return { ok: false, code: 'EXEC_NOT_DRAFT', message: 'La inspección ya no es editable.' };
  }

  if (d.respuestaId) {
    const belongs = await respuestaBelongsToExecution(supabase, d.respuestaId, d.executionId);
    if (!belongs) {
      return invalidInput([
        { path: ['respuestaId'], message: 'El hallazgo no pertenece a esta inspección.' },
      ]);
    }
  }

  let mime: 'image/png' | 'image/jpeg' | 'image/webp';
  let bytes: Uint8Array;
  try {
    ({ mime, bytes } = decodeImageDataUrl(d.dataUrl));
  } catch {
    return invalidInput([{ path: ['dataUrl'], message: 'Imagen inválida.' }]);
  }
  if (bytes.byteLength === 0) {
    return invalidInput([{ path: ['dataUrl'], message: 'Imagen vacía.' }]);
  }
  if (bytes.byteLength > MAX_ATTACHMENT_SIZE_BYTES) {
    return {
      ok: false,
      code: 'STORAGE_ERROR',
      message: 'La imagen excede el tamaño máximo (10 MB).',
    };
  }
  // C3 audit · magic-bytes anti-MIME-spoof (lesson T-024): el prefix declara el
  // mime pero el payload decodificado puede ser arbitrario.
  if (!magicBytesMatch(bytes, mime)) {
    return invalidInput([
      { path: ['dataUrl'], message: 'El contenido del archivo no coincide con una imagen válida.' },
    ]);
  }

  const admin = createServiceRoleClient();
  const adjuntoId = crypto.randomUUID();
  const storagePath = buildChecklistAdjuntoPath(
    pre.ctx.consultoraId,
    d.executionId,
    adjuntoId,
    extForImageMime(mime),
  );

  // Upload-first (service-role): si falla, no se inserta nada en DB.
  const { error: upErr } = await uploadChecklistAdjunto(admin, {
    path: storagePath,
    bytes,
    contentType: mime,
  });
  if (upErr) {
    logger.error(
      { err: upErr.message, executionId: d.executionId, consultoraId: pre.ctx.consultoraId },
      'uploadAdjuntoAction: storage upload failed',
    );
    return { ok: false, code: 'STORAGE_ERROR', message: 'No se pudo subir la foto. Reintentá.' };
  }

  // INSERT del row via RLS client (member + parent borrador). Rollback storage si falla.
  const { error: rowErr } = await supabase.from('execution_adjuntos').insert({
    id: adjuntoId,
    execution_id: d.executionId,
    respuesta_id: d.respuestaId ?? null,
    consultora_id: pre.ctx.consultoraId,
    storage_path: storagePath,
    mime_type: mime,
    size_bytes: bytes.byteLength,
    created_by: pre.ctx.userId,
  });

  if (rowErr) {
    const { error: cleanupErr } = await deleteChecklistAdjunto(admin, storagePath);
    if (cleanupErr) {
      logger.warn(
        { err: cleanupErr.message, storagePath, consultoraId: pre.ctx.consultoraId },
        'uploadAdjuntoAction: storage cleanup post row-fail failed (orphan)',
      );
    }
    if (rowErr.code === RLS_VIOLATION_CODE) {
      return { ok: false, code: 'EXEC_NOT_DRAFT', message: 'La inspección ya no es editable.' };
    }
    logger.error(
      { err: rowErr, executionId: d.executionId, consultoraId: pre.ctx.consultoraId },
      'uploadAdjuntoAction: row insert failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'No se pudo registrar la foto. Reintentá.',
    };
  }

  revalidateEjecucion(d.executionId);
  return { ok: true, adjuntoId, storagePath };
}

export async function deleteAdjuntoAction(input: unknown): Promise<DeleteAdjuntoResult> {
  const parsed = deleteAdjuntoSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues, 'ID inválido.');

  const supabase = await createClient();
  const pre = await requireMemberWithBilling(supabase);
  if (!pre.ok) return pre;

  const adj = await getAdjuntoForDelete(supabase, parsed.data.adjuntoId);
  if (!adj) return { ok: false, code: 'NOT_FOUND', message: 'Adjunto no encontrado.' };

  // DELETE via RLS (member + parent borrador). 0 filas = padre no-borrador (freeze).
  const { data, error } = await supabase
    .from('execution_adjuntos')
    .delete()
    .eq('id', parsed.data.adjuntoId)
    .select('id')
    .maybeSingle();

  if (error?.code === RLS_VIOLATION_CODE) {
    return { ok: false, code: 'EXEC_NOT_DRAFT', message: 'La inspección ya no es editable.' };
  }
  if (error) {
    logger.error(
      { err: error, adjuntoId: parsed.data.adjuntoId, consultoraId: pre.ctx.consultoraId },
      'deleteAdjuntoAction: delete failed',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'No se pudo borrar la foto. Reintentá.' };
  }
  if (!data) {
    return { ok: false, code: 'EXEC_NOT_DRAFT', message: 'La inspección ya no es editable.' };
  }

  // Borrado del objeto de storage: best-effort (el row ya no existe).
  const admin = createServiceRoleClient();
  const { error: delErr } = await deleteChecklistAdjunto(admin, adj.storage_path);
  if (delErr) {
    logger.warn(
      { err: delErr.message, storagePath: adj.storage_path, consultoraId: pre.ctx.consultoraId },
      'deleteAdjuntoAction: storage delete failed (orphan object)',
    );
  }

  revalidateEjecucion(adj.execution_id);
  return { ok: true };
}

// ============================== Cierre + firma ==============================

export async function cerrarEjecucionAction(input: unknown): Promise<CerrarEjecucionResult> {
  const parsed = cerrarEjecucionSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues);

  const supabase = await createClient();
  const pre = await requireOwnerWithBilling(supabase);
  if (!pre.ok) return pre;

  const d = parsed.data;
  const ctx = { userId: pre.ctx.userId, consultoraId: pre.ctx.consultoraId };

  // 1. Cargar la ejecución (RLS → tenant-scoped) + validar estado.
  const exec = await getEjecucionBasics(supabase, d.executionId);
  if (!exec) return { ok: false, code: 'NOT_FOUND', message: 'Inspección no encontrada.' };
  if (exec.estado === 'cerrada') {
    return { ok: false, code: 'ALREADY_CLOSED', message: 'La inspección ya está cerrada.' };
  }
  if (exec.estado !== 'borrador') {
    return { ok: false, code: 'EXEC_NOT_DRAFT', message: 'La inspección no se puede cerrar.' };
  }
  if (!exec.cliente_id) {
    return {
      ok: false,
      code: 'NO_CLIENTE',
      message: 'Asociá un cliente antes de cerrar la inspección.',
    };
  }

  // 2. Ítems + respuestas.
  const items = await getItemsForVersion(supabase, exec.template_version_id);
  const respuestas = await getRespuestasForExecution(supabase, d.executionId);
  const byItem = respuestasByItem(respuestas);

  // 3. Completitud (decisión 4): bloquea si hay es_requerido sin responder.
  const faltantes = findUnansweredRequired(items, byItem);
  if (faltantes.length > 0) {
    return {
      ok: false,
      code: 'EXEC_INCOMPLETE',
      faltantes,
      message: `Faltan ${faltantes.length} ítem(s) obligatorio(s) por responder antes de cerrar.`,
    };
  }

  // 4. Score (solo cumple_no_aplica; N-A fuera del denominador).
  const score = computeScore(items, byItem);

  // 5. Snapshot del establecimiento ← cliente (congelado al cierre).
  const cliente = await getClienteById(supabase, exec.cliente_id);
  if (!cliente) {
    logger.error(
      { ...ctx, executionId: d.executionId, clienteId: exec.cliente_id },
      'cerrarEjecucionAction: cliente no encontrado (RLS/borrado)',
    );
    return {
      ok: false,
      code: 'NO_CLIENTE',
      message: 'No se pudo cargar el cliente de la inspección.',
    };
  }

  // 6. Decode firma + size + magic-bytes PNG.
  let firmaBytes: Uint8Array;
  try {
    firmaBytes = decodeFirmaDataUrl(d.firma_base64);
  } catch {
    return invalidInput([{ path: ['firma_base64'], message: 'Firma inválida. Volvé a firmar.' }]);
  }
  if (firmaBytes.byteLength === 0) {
    return invalidInput([{ path: ['firma_base64'], message: 'Firma vacía.' }]);
  }
  if (firmaBytes.byteLength > MAX_EPP_FIRMA_SIZE_BYTES) {
    return {
      ok: false,
      code: 'STORAGE_ERROR',
      message: 'La firma excede el tamaño máximo permitido.',
    };
  }
  if (!magicBytesMatch(firmaBytes, 'image/png')) {
    return invalidInput([
      { path: ['firma_base64'], message: 'La firma debe ser una imagen PNG válida.' },
    ]);
  }

  // 7. Metadata de cierre + hash canónico (de DATOS, no del PDF).
  const admin = createServiceRoleClient();
  const cerradaAt = new Date().toISOString();
  const firmaPath = buildChecklistFirmaPath(pre.ctx.consultoraId, d.executionId);
  const fechaInspeccion = d.fecha_inspeccion ?? exec.fecha_inspeccion ?? cerradaAt.slice(0, 10);
  const firmanteMatricula = d.firmante_matricula ?? null;

  const firmaPdfHash = computeFirmaPdfHash({
    execution_id: d.executionId,
    template_version_id: exec.template_version_id,
    cliente_id: exec.cliente_id,
    score_cumple: score.score_cumple,
    score_no_cumple: score.score_no_cumple,
    score_na: score.score_na,
    cumplimiento_pct: score.cumplimiento_pct,
    tiene_criticos_incumplidos: score.tiene_criticos_incumplidos,
    cerrada_at: cerradaAt,
    firmante_nombre: d.firmante_nombre,
    firmante_matricula: firmanteMatricula,
    firma_storage_path: firmaPath,
    respuestas: respuestas.map((r) => ({
      template_item_id: r.template_item_id,
      valor: r.valor,
      valor_numerico: r.valor_numerico,
      observacion: r.observacion,
      fecha_regularizacion: r.fecha_regularizacion,
    })),
  });

  // 8. Upload firma (upsert:true → reintento idempotente).
  const { error: upErr } = await uploadChecklistFirma(admin, {
    path: firmaPath,
    bytes: firmaBytes,
  });
  if (upErr) {
    logger.error(
      { ...ctx, executionId: d.executionId, err: upErr.message },
      'cerrarEjecucionAction: firma upload failed (pre-INSERT)',
    );
    return { ok: false, code: 'STORAGE_ERROR', message: 'No se pudo guardar la firma. Reintentá.' };
  }

  // 9. INSERT execution_firmas (service-role). Idempotente: ante 23505 (orphan de
  //    un cierre previo fallido) actualiza la fila matriculado existente.
  const firmaRow = {
    execution_id: d.executionId,
    consultora_id: pre.ctx.consultoraId,
    rol: 'matriculado',
    firma_storage_path: firmaPath,
    firmante_nombre: d.firmante_nombre,
    firmante_matricula: firmanteMatricula,
    firmado_at: cerradaAt,
  };
  const { error: firmaErr } = await admin.from('execution_firmas').insert(firmaRow);
  if (firmaErr) {
    if (firmaErr.code === UNIQUE_VIOLATION_CODE) {
      const { error: updFirmaErr } = await admin
        .from('execution_firmas')
        .update({
          firma_storage_path: firmaPath,
          firmante_nombre: d.firmante_nombre,
          firmante_matricula: firmanteMatricula,
          firmado_at: cerradaAt,
        })
        .eq('execution_id', d.executionId)
        .eq('rol', 'matriculado');
      if (updFirmaErr) {
        await deleteChecklistFirma(admin, firmaPath);
        logger.error(
          { ...ctx, executionId: d.executionId, err: updFirmaErr.message },
          'cerrarEjecucionAction: firma update (idempotent) failed',
        );
        return {
          ok: false,
          code: 'INTERNAL_ERROR',
          message: 'No se pudo registrar la firma. Reintentá.',
        };
      }
    } else {
      await deleteChecklistFirma(admin, firmaPath);
      logger.error(
        { ...ctx, executionId: d.executionId, err: firmaErr.message },
        'cerrarEjecucionAction: firma insert failed',
      );
      return {
        ok: false,
        code: 'INTERNAL_ERROR',
        message: 'No se pudo registrar la firma. Reintentá.',
      };
    }
  }

  // 9.5 Generar CAPAs (1 por "no cumple") ANTES del flip. Idempotente
  //     (ON CONFLICT execution_id,respuesta_id). El flip (paso 10, último) solo
  //     se alcanza si esto corrió → una ejecución cerrada SIEMPRE tiene sus CAPAs.
  //     Si falla, la ejecución sigue borrador y el reintento re-corre todo.
  const capaRows = buildCapaRows(items, respuestas, cerradaAt);
  if (capaRows.length > 0) {
    // INSERT plano (no upsert): `uq_acciones_execution_respuesta` es un índice
    // PARCIAL (WHERE respuesta_id IS NOT NULL) → PostgREST no puede usarlo como
    // arbiter de ON CONFLICT (Postgres 42P10). Idempotencia: ante 23505 (el set
    // ya se insertó en un cierre previo fallido) se tolera y se sigue al gen.
    const { error: capaErr } = await admin.from('acciones_correctivas').insert(
      capaRows.map((c) => ({
        consultora_id: pre.ctx.consultoraId,
        execution_id: d.executionId,
        respuesta_id: c.respuesta_id,
        cliente_id: exec.cliente_id,
        descripcion: c.descripcion,
        prioridad: c.prioridad,
        fecha_compromiso: c.fecha_compromiso,
        created_by: pre.ctx.userId,
      })),
    );
    if (capaErr && capaErr.code !== UNIQUE_VIOLATION_CODE) {
      logger.error(
        { ...ctx, executionId: d.executionId, err: capaErr.message },
        'cerrarEjecucionAction: CAPA insert failed (ejecución sigue borrador → reintento)',
      );
      return {
        ok: false,
        code: 'INTERNAL_ERROR',
        message: 'No se pudieron generar las acciones correctivas. Reintentá.',
      };
    }
  }

  // 9.6 Inyectar las CAPAs al Calendario (warning NO-fatal, patrón EPP T-102).
  //     Idempotente: procesa solo acciones con calendar_event_id IS NULL.
  let calendarWarning: string | undefined;
  const { error: rpcErr } = await admin.rpc('gen_acciones_calendar_for', {
    p_execution_id: d.executionId,
  });
  if (rpcErr) {
    logger.warn(
      { ...ctx, executionId: d.executionId, err: rpcErr.message },
      'cerrarEjecucionAction: gen_acciones_calendar_for failed (CAPAs OK, recordatorios pendientes)',
    );
    calendarWarning =
      'Inspección cerrada. La generación de recordatorios en el calendario quedó pendiente — reintentá en unos minutos.';
  }

  // 10. Flip a cerrada con CAS (estado='borrador') — congela todo en un solo UPDATE.
  const { data: closed, error: updErr } = await admin
    .from('checklist_executions')
    .update({
      estado: 'cerrada',
      cerrada_at: cerradaAt,
      fecha_inspeccion: fechaInspeccion,
      score_cumple: score.score_cumple,
      score_no_cumple: score.score_no_cumple,
      score_na: score.score_na,
      cumplimiento_pct: score.cumplimiento_pct,
      tiene_criticos_incumplidos: score.tiene_criticos_incumplidos,
      establecimiento_razon_social: cliente.razon_social,
      establecimiento_cuit: cliente.cuit,
      establecimiento_domicilio: cliente.domicilio,
      establecimiento_localidad: cliente.localidad,
      establecimiento_provincia: cliente.provincia,
      firma_pdf_hash: firmaPdfHash,
      gps_lat: d.gps_lat ?? null,
      gps_lng: d.gps_lng ?? null,
    })
    .eq('id', d.executionId)
    .eq('estado', 'borrador')
    .eq('consultora_id', pre.ctx.consultoraId)
    .select('id')
    .maybeSingle();

  if (updErr) {
    // La firma queda (válida, ejecución aún borrador) → un reintento la reusa (23505→update).
    logger.error(
      { ...ctx, executionId: d.executionId, err: updErr.message },
      'cerrarEjecucionAction: flip a cerrada failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'No se pudo cerrar la inspección. Reintentá.',
    };
  }
  if (!closed) {
    // CAS miss: otra pestaña cerró/anuló entre el guard y el flip.
    return {
      ok: false,
      code: 'ALREADY_CLOSED',
      message: 'La inspección ya fue cerrada o anulada.',
    };
  }

  revalidateEjecucion(d.executionId);
  revalidatePath('/calendario');
  logger.info(
    {
      ...ctx,
      executionId: d.executionId,
      cumplimiento_pct: score.cumplimiento_pct,
      tiene_criticos_incumplidos: score.tiene_criticos_incumplidos,
      capaCount: capaRows.length,
      calendarWarning: calendarWarning ? true : undefined,
      action: 'cerrar_ejecucion',
    },
    'cerrarEjecucionAction: closed',
  );
  return {
    ok: true,
    executionId: d.executionId,
    cumplimiento_pct: score.cumplimiento_pct,
    tiene_criticos_incumplidos: score.tiene_criticos_incumplidos,
    capaCount: capaRows.length,
    ...(calendarWarning ? { calendarWarning } : {}),
  };
}

// ============================== Anular (tombstone + cascada) ==============================

export async function anularEjecucionAction(input: unknown): Promise<AnularEjecucionResult> {
  const parsed = anularEjecucionSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues, 'Datos inválidos.');

  const supabase = await createClient();
  const pre = await requireOwnerWithBilling(supabase);
  if (!pre.ok) return pre;

  const d = parsed.data;
  const ctx = { userId: pre.ctx.userId, consultoraId: pre.ctx.consultoraId };

  // 1. Cargar target (RLS → tenant-scoped).
  const exec = await getEjecucionBasics(supabase, d.executionId);
  if (!exec) return { ok: false, code: 'NOT_FOUND', message: 'Inspección no encontrada.' };
  if (exec.estado === 'anulada') {
    return { ok: false, code: 'ALREADY_ANULLED', message: 'La inspección ya está anulada.' };
  }

  const admin = createServiceRoleClient();

  // 2. CASCADA primero (idempotente). Se corre ANTES del tombstone para ser
  //    retry-safe: si el tombstone falla, el reintento re-aplica la cascada
  //    (no-op) + tombstone; si la cascada falla, la ejecución aún NO está
  //    tombstoneada → el reintento la completa.
  //  a. acciones_correctivas → anulada.
  const { error: capasErr } = await admin
    .from('acciones_correctivas')
    .update({ estado: 'anulada' })
    .eq('execution_id', d.executionId)
    .neq('estado', 'anulada');
  if (capasErr) {
    logger.error(
      { ...ctx, executionId: d.executionId, err: capasErr.message },
      'anularEjecucionAction: cascade acciones failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'No se pudieron anular las acciones correctivas. Reintentá.',
    };
  }

  //  b/c. Eventos + reminders de TODAS las CAPAs de la ejecución (subquery
  //       implícito leyendo todas las acciones, NO un RETURNING de las recién
  //       anuladas → un reintento tras falla entre (a) y (b) igual los cancela).
  const { data: capasConEvento } = await admin
    .from('acciones_correctivas')
    .select('calendar_event_id')
    .eq('execution_id', d.executionId)
    .not('calendar_event_id', 'is', null);
  const eventIds = [
    ...new Set(
      (capasConEvento ?? []).map((c) => c.calendar_event_id).filter((x): x is string => x != null),
    ),
  ];

  if (eventIds.length > 0) {
    const { error: evErr } = await admin
      .from('calendar_events')
      .update({ status: 'cancelled' })
      .in('id', eventIds)
      .neq('status', 'cancelled');
    if (evErr) {
      logger.error(
        { ...ctx, executionId: d.executionId, err: evErr.message },
        'anularEjecucionAction: cancel calendar_events failed',
      );
      return {
        ok: false,
        code: 'INTERNAL_ERROR',
        message: 'No se pudieron cancelar los eventos del calendario. Reintentá.',
      };
    }
    const { error: remErr } = await admin
      .from('calendar_event_reminders')
      .update({ status: 'skipped' })
      .in('event_id', eventIds)
      .eq('status', 'pending');
    if (remErr) {
      logger.error(
        { ...ctx, executionId: d.executionId, err: remErr.message },
        'anularEjecucionAction: skip reminders failed',
      );
      return {
        ok: false,
        code: 'INTERNAL_ERROR',
        message: 'No se pudieron cancelar los recordatorios. Reintentá.',
      };
    }
  }

  // 3. Tombstone (service-role). 23505 (uq_checklist_exec_corrige) → ALREADY_ANULLED.
  const { data: tombstone, error: tombErr } = await admin
    .from('checklist_executions')
    .insert({
      consultora_id: pre.ctx.consultoraId,
      created_by: pre.ctx.userId,
      corrige_id: d.executionId,
      anulacion: true,
      estado: 'anulada',
      template_version_id: exec.template_version_id,
      cliente_id: exec.cliente_id,
    })
    .select('id')
    .maybeSingle();

  if (tombErr) {
    if (tombErr.code === UNIQUE_VIOLATION_CODE) {
      return {
        ok: false,
        code: 'ALREADY_ANULLED',
        message: 'La inspección ya fue anulada o corregida.',
      };
    }
    logger.error(
      { ...ctx, executionId: d.executionId, err: tombErr.message },
      'anularEjecucionAction: tombstone insert failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'No se pudo anular la inspección. Reintentá.',
    };
  }
  if (!tombstone) {
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'No se pudo anular la inspección. Reintentá.',
    };
  }

  revalidateEjecucion(d.executionId);
  revalidatePath('/calendario');
  logger.info(
    {
      ...ctx,
      executionId: d.executionId,
      tombstoneId: tombstone.id,
      motivo: d.motivo ?? null,
      action: 'anular_ejecucion',
    },
    'anularEjecucionAction: annulled',
  );
  return { ok: true, tombstoneId: tombstone.id };
}
