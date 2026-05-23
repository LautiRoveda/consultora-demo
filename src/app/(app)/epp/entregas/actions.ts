'use server';

import { revalidatePath } from 'next/cache';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { logger } from '@/shared/observability/logger';
import {
  buildEppFirmaPath,
  decodeFirmaDataUrl,
  deleteEppFirma,
  uploadEppFirma,
} from '@/shared/storage/epp-firmas';
import { MAX_EPP_FIRMA_SIZE_BYTES } from '@/shared/storage/types';
import { createClient } from '@/shared/supabase/server';
import { createServiceRoleClient } from '@/shared/supabase/service-role';

import { createEntregaSchema } from './schema';

const CHECK_VIOLATION_CODE = '23514';

export type CreateEntregaResult =
  | { ok: true; entregaId: string; planificacionWarning?: string }
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
        | 'FORBIDDEN_NOT_OWNER'
        | 'EMPLEADO_NOT_FOUND'
        | 'ITEM_NOT_FOUND'
        | 'STORAGE_ERROR'
        | 'INTERNAL_ERROR';
      message: string;
    };

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

/**
 * Rollback manual del header epp_entregas (cascade borra epp_entrega_items por
 * FK ON DELETE CASCADE). Best-effort: si el rollback falla, log + continue.
 * No es transaccional (postgres trx atravesando admin client no garantizado),
 * pero el rollback determinístico por entrega_id es suficiente para MVP.
 */
async function rollbackEntrega(
  admin: ReturnType<typeof createServiceRoleClient>,
  entregaId: string,
  storagePath: string | null,
  context: { userId: string; consultoraId: string; reason: string },
): Promise<void> {
  if (storagePath) {
    const { error: delErr } = await deleteEppFirma(admin, storagePath);
    if (delErr) {
      logger.warn(
        { ...context, entregaId, err: delErr.message },
        'createEntregaAction: rollback firma delete failed (orphan storage object)',
      );
    }
  }
  const { error: delHeaderErr } = await admin.from('epp_entregas').delete().eq('id', entregaId);
  if (delHeaderErr) {
    logger.error(
      { ...context, entregaId, err: delHeaderErr.message },
      'createEntregaAction: rollback header delete failed (orphan entrega + items)',
    );
  }
}

export async function createEntregaAction(input: unknown): Promise<CreateEntregaResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, code: 'UNAUTHENTICATED', message: 'Necesitás iniciar sesión.' };
  }

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    logger.warn({ userId: user.id }, 'createEntregaAction: user without consultora membership');
    return {
      ok: false,
      code: 'NO_CONSULTORA',
      message: 'No tenés una consultora asociada.',
    };
  }

  if (consultora.role !== 'owner') {
    return {
      ok: false,
      code: 'FORBIDDEN_NOT_OWNER',
      message: 'Solo el titular de la consultora puede registrar entregas EPP (Res SRT 299/11).',
    };
  }

  const parsed = createEntregaSchema.safeParse(input);
  if (!parsed.success) {
    const { fieldErrors } = buildInvalidInput(parsed.error.issues);
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors,
      message: 'Revisá los campos del formulario.',
    };
  }

  const { empleado_id, items, firma_base64, observaciones } = parsed.data;

  // Cross-tenant defense: empleado debe ser visible bajo el JWT del user.
  // RLS filtra cross-tenant a null si pertenece a otra consultora.
  const { data: empleadoRow } = await supabase
    .from('empleados')
    .select('id, cliente_id, archived_at')
    .eq('id', empleado_id)
    .maybeSingle();
  if (!empleadoRow || empleadoRow.archived_at !== null) {
    return {
      ok: false,
      code: 'EMPLEADO_NOT_FOUND',
      message: 'Empleado no encontrado o archivado.',
    };
  }

  // Cross-tenant defense: cada item debe ser visible + activo + recuperar flags.
  const itemIds = items.map((i) => i.item_id);
  const { data: itemsRows } = await supabase
    .from('epp_items')
    .select('id, requiere_numero_serie, archived_at')
    .in('id', itemIds);

  const itemsMap = new Map(
    (itemsRows ?? []).filter((r) => r.archived_at === null).map((r) => [r.id, r]),
  );
  for (const item of items) {
    if (!itemsMap.has(item.item_id)) {
      return {
        ok: false,
        code: 'ITEM_NOT_FOUND',
        message: 'Uno de los items EPP no existe o fue archivado. Refrescá el formulario.',
      };
    }
  }

  // Pre-validación de numero_serie (defensa app-layer; el trigger SQL es la
  // última barrera). Permite devolver fieldErrors específicos por índice.
  const fieldErrors: Record<string, string[]> = {};
  items.forEach((item, idx) => {
    const catalog = itemsMap.get(item.item_id);
    if (catalog?.requiere_numero_serie) {
      const ns = (item.numero_serie ?? '').trim();
      if (ns.length === 0) {
        (fieldErrors[`items.${idx}.numero_serie`] ??= []).push(
          'Este item requiere número de serie.',
        );
      }
    }
  });
  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors,
      message: 'Algunos items requieren número de serie.',
    };
  }

  // Decode firma + size guard.
  let firmaBytes: Uint8Array;
  try {
    firmaBytes = decodeFirmaDataUrl(firma_base64);
  } catch (err) {
    logger.warn(
      { userId: user.id, consultoraId: consultora.id, err: (err as Error).message },
      'createEntregaAction: firma decode failed',
    );
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: { firma_base64: ['Firma inválida. Volvé a firmar.'] },
      message: 'No pudimos procesar la firma.',
    };
  }
  if (firmaBytes.byteLength === 0) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: { firma_base64: ['Firma vacía.'] },
      message: 'La firma está vacía.',
    };
  }
  if (firmaBytes.byteLength > MAX_EPP_FIRMA_SIZE_BYTES) {
    return {
      ok: false,
      code: 'STORAGE_ERROR',
      message: 'La firma excede el tamaño máximo permitido.',
    };
  }

  const admin = createServiceRoleClient();
  const ctx = { userId: user.id, consultoraId: consultora.id };

  // Step 1: INSERT header.
  const { data: entregaRow, error: headerErr } = await admin
    .from('epp_entregas')
    .insert({
      consultora_id: consultora.id,
      empleado_id,
      cliente_id: empleadoRow.cliente_id,
      observaciones: observaciones ?? null,
      created_by: user.id,
    })
    .select('id')
    .single();

  if (headerErr || !entregaRow) {
    logger.error({ ...ctx, err: headerErr?.message }, 'createEntregaAction: header insert failed');
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'No se pudo crear la entrega. Reintentá.',
    };
  }

  const entregaId = entregaRow.id;

  // Step 2: INSERT items (batch). Si falla, rollback header.
  const itemsPayload = items.map((item) => ({
    entrega_id: entregaId,
    consultora_id: consultora.id,
    item_id: item.item_id,
    cantidad: item.cantidad,
    numero_serie: item.numero_serie ?? null,
    motivo_entrega: item.motivo_entrega,
    vida_util_meses_override: item.vida_util_meses_override ?? null,
    marca_entregada: item.marca_entregada ?? null,
    modelo_entregado: item.modelo_entregado ?? null,
  }));

  const { error: itemsErr } = await admin.from('epp_entrega_items').insert(itemsPayload);

  if (itemsErr) {
    await rollbackEntrega(admin, entregaId, null, { ...ctx, reason: 'items_insert_failed' });

    // El trigger BEFORE INSERT validate_serie usa errcode 23514. Devolvemos
    // fieldError genérico (no sabemos qué item lo disparó sin re-fetch).
    if (itemsErr.code === CHECK_VIOLATION_CODE) {
      logger.warn(
        { ...ctx, entregaId, err: itemsErr.message },
        'createEntregaAction: numero_serie check violation (slipped past app-layer pre-validation)',
      );
      return {
        ok: false,
        code: 'INVALID_INPUT',
        fieldErrors: {
          _: ['Algún item requiere número de serie y no lo recibió. Verificá el formulario.'],
        },
        message: 'Falta número de serie en algún item.',
      };
    }

    logger.error(
      { ...ctx, entregaId, err: itemsErr.message },
      'createEntregaAction: items insert failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'No se pudieron registrar los items de la entrega. Reintentá.',
    };
  }

  // Step 3: Upload firma a storage.
  const storagePath = buildEppFirmaPath(consultora.id, entregaId);
  const { error: uploadErr } = await uploadEppFirma(admin, {
    path: storagePath,
    bytes: firmaBytes,
  });
  if (uploadErr) {
    await rollbackEntrega(admin, entregaId, null, { ...ctx, reason: 'upload_failed' });
    logger.error(
      { ...ctx, entregaId, err: uploadErr.message },
      'createEntregaAction: firma upload failed',
    );
    return {
      ok: false,
      code: 'STORAGE_ERROR',
      message: 'No se pudo guardar la firma. Reintentá.',
    };
  }

  // Step 4: UPDATE header con firma_storage_path + firmado_at.
  const { error: updateErr } = await admin
    .from('epp_entregas')
    .update({
      firma_storage_path: storagePath,
      firmado_at: new Date().toISOString(),
    })
    .eq('id', entregaId);

  if (updateErr) {
    await rollbackEntrega(admin, entregaId, storagePath, { ...ctx, reason: 'sign_update_failed' });
    logger.error(
      { ...ctx, entregaId, err: updateErr.message },
      'createEntregaAction: sign update failed',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'No se pudo cerrar la entrega. Reintentá.',
    };
  }

  // Step 5: invocar gen_epp_planificaciones_y_calendar_for. Si falla, NO
  // rollback — la entrega firmada queda válida y se regenera planificación
  // manualmente (T-102-FU1 expuesto via warning embebido en el return).
  let planificacionWarning: string | undefined;
  const { error: rpcErr } = await admin.rpc('gen_epp_planificaciones_y_calendar_for', {
    p_entrega_id: entregaId,
  });
  if (rpcErr) {
    logger.warn(
      { ...ctx, entregaId, err: rpcErr.message },
      'createEntregaAction: gen_epp_planificaciones RPC failed (entrega OK, planificación pendiente)',
    );
    planificacionWarning =
      'Entrega firmada correctamente. La generación de la planificación 6m quedó pendiente — el recordatorio aparecerá en breve.';
  }

  revalidatePath('/epp/entregas');
  revalidatePath('/calendario');

  logger.info(
    { ...ctx, entregaId, itemsCount: items.length, action: 'create_entrega' },
    'createEntregaAction: created',
  );

  return planificacionWarning
    ? { ok: true, entregaId, planificacionWarning }
    : { ok: true, entregaId };
}
