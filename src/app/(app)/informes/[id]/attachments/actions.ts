'use server';

import { revalidatePath } from 'next/cache';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { logger } from '@/shared/observability/logger';
import { deleteAttachmentFromStorage } from '@/shared/storage/attachments';
import { createClient } from '@/shared/supabase/server';
import { createServiceRoleClient } from '@/shared/supabase/service-role';

import { reorderInputSchema, updateCaptionInputSchema } from './schema';

/**
 * T-024 · Server actions para attachments.
 *
 * Upload va por route handler (multipart, body > 1 MB), aca solo operaciones
 * sobre filas existentes:
 *  - updateAttachmentCaptionAction
 *  - reorderInformeAttachmentsAction
 *  - deleteInformeAttachmentAction
 *
 * Cada una sigue el patron canonico T-019/T-020/T-021/T-023:
 *  1. Zod safeParse input.
 *  2. Auth: getUser.
 *  3. Consultora: getCurrentConsultora.
 *  4. Cargar attachment + informe via RLS para distinguir NOT_FOUND vs FORBIDDEN.
 *  5. Permission gate defensivo (creator OR owner).
 *  6. Operacion + revalidatePath.
 */

type BaseError =
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: Record<string, string[]>; message: string }
  | {
      ok: false;
      code:
        | 'UNAUTHENTICATED'
        | 'NO_CONSULTORA'
        | 'NOT_FOUND'
        | 'FORBIDDEN'
        | 'STORAGE_ERROR'
        | 'INTERNAL_ERROR';
      message: string;
    };

export type UpdateAttachmentCaptionResult = { ok: true; attachmentId: string } | BaseError;

export type ReorderAttachmentsResult = { ok: true; count: number } | BaseError;

export type DeleteAttachmentResult = { ok: true; attachmentId: string } | BaseError;

function buildInvalidInput(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): {
  fieldErrors: Record<string, string[]>;
} {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.map((p) => String(p)).join('.') || '_';
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return { fieldErrors };
}

export async function updateAttachmentCaptionAction(
  attachmentId: string,
  input: unknown,
): Promise<UpdateAttachmentCaptionResult> {
  const parsed = updateCaptionInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      ...buildInvalidInput(parsed.error.issues),
      message: 'Caption invalido.',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: 'UNAUTHENTICATED', message: 'Iniciá sesión.' };

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    return {
      ok: false,
      code: 'NO_CONSULTORA',
      message: 'Tu cuenta no tiene una consultora vinculada.',
    };
  }

  const { data: att } = await supabase
    .from('informe_attachments')
    .select('id, informe_id, kind, informe:informes!inner(created_by, id)')
    .eq('id', attachmentId)
    .maybeSingle();
  if (!att) return { ok: false, code: 'NOT_FOUND', message: 'Adjunto no encontrado.' };

  if (att.kind !== 'image') {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: {},
      message: 'Los archivos no-imagen no aceptan caption.',
    };
  }

  const isCreator = att.informe.created_by === user.id;
  const isOwner = consultora.role === 'owner';
  if (!isCreator && !isOwner) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'Solo el creador del informe o un owner pueden editar adjuntos.',
    };
  }

  const { data, error } = await supabase
    .from('informe_attachments')
    .update({ caption: parsed.data.caption })
    .eq('id', attachmentId)
    .select('id');

  if (error) {
    logger.error(
      { err: error, attachmentId, userId: user.id, consultoraId: consultora.id },
      'updateAttachmentCaptionAction: update fallo',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Error actualizando el caption.' };
  }
  if (!data || data.length === 0) {
    return { ok: false, code: 'FORBIDDEN', message: 'No tenés permiso para editar este adjunto.' };
  }

  revalidatePath(`/informes/${att.informe.id}/editar`);
  revalidatePath(`/informes/${att.informe.id}`);
  return { ok: true, attachmentId };
}

export async function reorderInformeAttachmentsAction(
  informeId: string,
  input: unknown,
): Promise<ReorderAttachmentsResult> {
  const parsed = reorderInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      ...buildInvalidInput(parsed.error.issues),
      message: 'Lista de orden invalida.',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: 'UNAUTHENTICATED', message: 'Iniciá sesión.' };

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    return {
      ok: false,
      code: 'NO_CONSULTORA',
      message: 'Tu cuenta no tiene una consultora vinculada.',
    };
  }

  const { data: informe } = await supabase
    .from('informes')
    .select('id, created_by')
    .eq('id', informeId)
    .maybeSingle();
  if (!informe) return { ok: false, code: 'NOT_FOUND', message: 'Informe no encontrado.' };

  const isCreator = informe.created_by === user.id;
  const isOwner = consultora.role === 'owner';
  if (!isCreator && !isOwner) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'Solo el creador del informe o un owner pueden reordenar adjuntos.',
    };
  }

  // Verificar que TODOS los IDs pertenecen al informe (cross-informe sanity check).
  const { data: existing } = await supabase
    .from('informe_attachments')
    .select('id, kind')
    .eq('informe_id', informeId)
    .in('id', parsed.data.orderedIds);

  if (!existing || existing.length !== parsed.data.orderedIds.length) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: { orderedIds: ['Hay IDs que no pertenecen al informe.'] },
      message: 'Lista de orden invalida.',
    };
  }

  // Solo reordenamos images (los files no tienen orden visual en PDF).
  if (existing.some((row) => row.kind !== 'image')) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: { orderedIds: ['Solo se pueden reordenar imagenes.'] },
      message: 'Solo se pueden reordenar imagenes.',
    };
  }

  // Update bulk: 1 UPDATE por ID con su posicion nueva. RLS gate aplica.
  // En el peor caso son ~20 statements; aceptable para una operacion UI.
  let updated = 0;
  for (let i = 0; i < parsed.data.orderedIds.length; i += 1) {
    const id = parsed.data.orderedIds[i]!;
    const { data, error } = await supabase
      .from('informe_attachments')
      .update({ position: i })
      .eq('id', id)
      .eq('informe_id', informeId)
      .select('id');
    if (error) {
      logger.error(
        { err: error, attachmentId: id, informeId, position: i, userId: user.id },
        'reorderInformeAttachmentsAction: update fallo',
      );
      return { ok: false, code: 'INTERNAL_ERROR', message: 'Error al reordenar.' };
    }
    if (data && data.length > 0) updated += 1;
  }

  revalidatePath(`/informes/${informeId}/editar`);
  revalidatePath(`/informes/${informeId}`);
  return { ok: true, count: updated };
}

export async function deleteInformeAttachmentAction(
  attachmentId: string,
): Promise<DeleteAttachmentResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: 'UNAUTHENTICATED', message: 'Iniciá sesión.' };

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    return {
      ok: false,
      code: 'NO_CONSULTORA',
      message: 'Tu cuenta no tiene una consultora vinculada.',
    };
  }

  const { data: att } = await supabase
    .from('informe_attachments')
    .select('id, informe_id, storage_path, informe:informes!inner(created_by, id)')
    .eq('id', attachmentId)
    .maybeSingle();
  if (!att) return { ok: false, code: 'NOT_FOUND', message: 'Adjunto no encontrado.' };

  const isCreator = att.informe.created_by === user.id;
  const isOwner = consultora.role === 'owner';
  if (!isCreator && !isOwner) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'Solo el creador del informe o un owner pueden eliminar adjuntos.',
    };
  }

  // Storage primero, despues DB: si Storage falla, no tocamos DB (no quedamos
  // con row sin objeto). Si DB falla post-Storage, queda objeto huerfano que
  // cron job de cleanup va a recoger (T-024-FU1).
  const admin = createServiceRoleClient();
  const { error: storageError } = await deleteAttachmentFromStorage(admin, att.storage_path);
  if (storageError) {
    logger.error(
      { err: storageError, attachmentId, storagePath: att.storage_path },
      'deleteInformeAttachmentAction: storage delete fallo',
    );
    return { ok: false, code: 'STORAGE_ERROR', message: 'Error eliminando el archivo.' };
  }

  const { data, error } = await supabase
    .from('informe_attachments')
    .delete()
    .eq('id', attachmentId)
    .select('id');

  if (error) {
    logger.error(
      { err: error, attachmentId, userId: user.id, consultoraId: consultora.id },
      'deleteInformeAttachmentAction: delete fallo',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Error eliminando el adjunto.' };
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'No tenés permiso para eliminar este adjunto.',
    };
  }

  revalidatePath(`/informes/${att.informe.id}/editar`);
  revalidatePath(`/informes/${att.informe.id}`);
  return { ok: true, attachmentId };
}
