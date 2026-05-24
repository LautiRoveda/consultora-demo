import { revalidatePath } from 'next/cache';
import { type NextRequest } from 'next/server';

import { countInformeAttachments } from '@/app/(app)/informes/[id]/attachments/queries';
import { getInformeById } from '@/app/(app)/informes/queries';
import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { logger } from '@/shared/observability/logger';
import {
  deleteAttachmentFromStorage,
  uploadAttachmentToStorage,
} from '@/shared/storage/attachments';
import { buildAttachmentPath } from '@/shared/storage/paths';
import { processAttachmentImage } from '@/shared/storage/sharp-pipeline';
import { MAX_ATTACHMENTS_PER_INFORME } from '@/shared/storage/types';
import {
  kindForMime,
  magicBytesMatch,
  sanitizeFilename,
  validateAttachmentMime,
  validateAttachmentSize,
} from '@/shared/storage/validators';
import { createClient } from '@/shared/supabase/server';
import { createServiceRoleClient } from '@/shared/supabase/service-role';

/**
 * T-024 · POST /api/informes/[id]/attachments
 *
 * Upload multipart de un adjunto (imagen o file). El cliente envia FormData
 * con `file: File` (binario + Content-Type del browser). Opcional: `caption`
 * (solo para images).
 *
 * Flow:
 *  1. Validar UUID del informe.
 *  2. Auth + getCurrentConsultora.
 *  3. Cargar informe via RLS (NOT_FOUND si cross-tenant).
 *  4. Permission gate (creator OR owner).
 *  5. Quota check: count < MAX_ATTACHMENTS_PER_INFORME.
 *  6. Parse FormData + validar MIME + size + filename.
 *  7. Para images: sharp pipeline (rotate + strip EXIF + resize).
 *  8. Magic bytes check (defensa anti-MIME-spoof).
 *  9. Build storage path + upload via service-role.
 * 10. Insert row via auth client (RLS + audit trigger captura auth.uid()).
 *     Si DB insert falla, rollback storage delete.
 * 11. revalidate + return JSON.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ErrorBody = { code: string; message: string; fieldErrors?: Record<string, string[]> };

function errorResponse(status: number, body: ErrorBody): Response {
  return Response.json(body, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  if (!UUID_REGEX.test(id)) {
    return errorResponse(400, { code: 'INVALID_INPUT', message: 'ID de informe invalido.' });
  }

  // Auth.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return errorResponse(401, { code: 'UNAUTHENTICATED', message: 'Iniciá sesión.' });
  }

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    return errorResponse(403, {
      code: 'NO_CONSULTORA',
      message: 'Tu cuenta no tiene una consultora vinculada.',
    });
  }

  // Informe + gate.
  const informe = await getInformeById(supabase, id);
  if (!informe) {
    return errorResponse(404, { code: 'NOT_FOUND', message: 'Informe no encontrado.' });
  }
  const isCreator = informe.created_by === user.id;
  const isOwner = consultora.role === 'owner';
  if (!isCreator && !isOwner) {
    return errorResponse(403, {
      code: 'FORBIDDEN',
      message: 'Solo el creador del informe o un owner pueden adjuntar archivos.',
    });
  }

  // Quota check.
  const currentCount = await countInformeAttachments(supabase, id);
  if (currentCount >= MAX_ATTACHMENTS_PER_INFORME) {
    return errorResponse(409, {
      code: 'QUOTA_EXCEEDED',
      message: `Alcanzaste el limite de ${MAX_ATTACHMENTS_PER_INFORME} adjuntos por informe.`,
    });
  }

  // Parse FormData.
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    logger.warn(
      { err: String(err), informeId: id, userId: user.id },
      'attachments_upload: FormData parse fallo',
    );
    return errorResponse(400, {
      code: 'INVALID_INPUT',
      message: 'Cuerpo invalido (multipart/form-data esperado).',
    });
  }

  const file = formData.get('file');
  if (!(file instanceof Blob)) {
    return errorResponse(400, {
      code: 'INVALID_INPUT',
      fieldErrors: { file: ['Falta el archivo.'] },
      message: 'Falta el archivo.',
    });
  }

  const captionRaw = formData.get('caption');
  const captionInput =
    typeof captionRaw === 'string' && captionRaw.trim().length > 0 ? captionRaw.trim() : null;

  // Filename: `File` (Web API) extiende Blob con .name. FormData.get devuelve
  // Blob | File | string segun como se mando; chequeamos .name defensivo.
  const originalFilename =
    typeof (file as { name?: unknown }).name === 'string' &&
    (file as { name: string }).name.length > 0
      ? (file as { name: string }).name
      : 'archivo';
  const filename = sanitizeFilename(originalFilename);

  const claimedMime = file.type || 'application/octet-stream';

  // Validaciones MIME + size.
  const mimeError = validateAttachmentMime(claimedMime);
  if (mimeError) {
    return errorResponse(415, { code: mimeError.code, message: mimeError.message });
  }
  const sizeError = validateAttachmentSize(file.size);
  if (sizeError) {
    return errorResponse(413, { code: sizeError.code, message: sizeError.message });
  }

  const kind = kindForMime(claimedMime);
  if (!kind) {
    // Defensive: validateAttachmentMime ya lo cubrio, pero TS no narrowea.
    return errorResponse(415, {
      code: 'UNSUPPORTED_MIME',
      message: `Tipo no soportado: ${claimedMime}`,
    });
  }

  // Read bytes.
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (err) {
    logger.error(
      { err: String(err), informeId: id, userId: user.id },
      'attachments_upload: arrayBuffer fallo',
    );
    return errorResponse(500, { code: 'INTERNAL_ERROR', message: 'No se pudo leer el archivo.' });
  }

  // Magic bytes check (anti-MIME-spoof).
  if (!magicBytesMatch(bytes, claimedMime)) {
    return errorResponse(415, {
      code: 'MAGIC_BYTES_MISMATCH',
      message: 'El contenido del archivo no coincide con su tipo declarado.',
    });
  }

  // Sharp pipeline para images: rotate (EXIF), strip EXIF, resize si > 2400px.
  let finalBytes: Buffer | Uint8Array = bytes;
  let finalMime = claimedMime;
  if (kind === 'image') {
    try {
      const processed = await processAttachmentImage(Buffer.from(bytes));
      finalBytes = processed.buffer;
      finalMime = processed.mime;
    } catch (err) {
      logger.warn(
        { err: String(err), informeId: id, userId: user.id, mime: claimedMime },
        'attachments_upload: sharp pipeline fallo, rechazamos el upload',
      );
      return errorResponse(422, {
        code: 'UNSUPPORTED_MIME',
        message: 'No se pudo procesar la imagen. Probá con otro archivo.',
      });
    }
  }

  // Build storage path + upload.
  // Cross-tenant defense audited AUD-003: getInformeById usa authed client
  // (RLS-aware) → 404 si el informe es de otro tenant. Gate creator OR owner
  // verificado arriba. Admin client se usa SOLO para storage upload + rollback;
  // la INSERT en DB sigue usando supabase authed (RLS + audit trigger).
  const storagePath = buildAttachmentPath({
    consultoraId: consultora.id,
    informeId: id,
    mime: finalMime,
  });
  const admin = createServiceRoleClient();
  const { error: storageError } = await uploadAttachmentToStorage(admin, {
    path: storagePath,
    bytes: finalBytes,
    contentType: finalMime,
  });
  if (storageError) {
    logger.error(
      { err: storageError.message, informeId: id, userId: user.id, storagePath },
      'attachments_upload: storage upload fallo',
    );
    return errorResponse(500, {
      code: 'STORAGE_ERROR',
      message: 'No se pudo subir el archivo.',
    });
  }

  // Insert row via auth client (RLS + audit captura auth.uid()).
  const finalSize = finalBytes instanceof Buffer ? finalBytes.length : finalBytes.byteLength;
  const { data: inserted, error: insertError } = await supabase
    .from('informe_attachments')
    .insert({
      informe_id: id,
      consultora_id: consultora.id,
      kind,
      storage_path: storagePath,
      filename,
      mime_type: finalMime,
      size_bytes: finalSize,
      caption: kind === 'image' ? captionInput : null,
      position: currentCount,
      uploaded_by: user.id,
    })
    .select(
      'id, kind, filename, mime_type, size_bytes, caption, position, storage_path, created_at',
    )
    .single();

  if (insertError || !inserted) {
    // Rollback storage.
    void deleteAttachmentFromStorage(admin, storagePath).catch(() => {});
    logger.error(
      { err: insertError, informeId: id, userId: user.id, storagePath },
      'attachments_upload: DB insert fallo, rollback storage',
    );
    return errorResponse(500, { code: 'INTERNAL_ERROR', message: 'Error guardando el adjunto.' });
  }

  logger.info(
    {
      informeId: id,
      userId: user.id,
      consultoraId: consultora.id,
      attachmentId: inserted.id,
      kind,
      mime: finalMime,
      sizeBytes: finalSize,
    },
    'attachments_uploaded',
  );

  revalidatePath(`/informes/${id}/editar`);
  revalidatePath(`/informes/${id}`);

  return Response.json({ ok: true, attachment: inserted }, { status: 201 });
}
