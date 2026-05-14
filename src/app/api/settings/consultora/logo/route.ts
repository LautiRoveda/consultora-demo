import { revalidatePath } from 'next/cache';
import { type NextRequest } from 'next/server';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { logger } from '@/shared/observability/logger';
import { deleteLogoFromStorage, uploadLogoToStorage } from '@/shared/storage/logo';
import { buildLogoPath } from '@/shared/storage/paths';
import { processLogoImage } from '@/shared/storage/sharp-pipeline';
import { magicBytesMatch, validateLogoMime, validateLogoSize } from '@/shared/storage/validators';
import { createClient } from '@/shared/supabase/server';
import { createServiceRoleClient } from '@/shared/supabase/service-role';

/**
 * T-024 · POST /api/settings/consultora/logo
 *
 * Upload del logo de la consultora. Owner-only (RLS + gate explicito).
 *
 * Si ya hay logo previo, se elimina su storage object antes de subir el nuevo.
 * El UPDATE de `consultoras.logo_storage_path` es atomico.
 *
 * Flow:
 *  1. Auth + consultora + gate owner-only.
 *  2. Parse FormData + validar MIME + size.
 *  3. Sharp pipeline (rotate + strip EXIF + resize a max 600px).
 *  4. Magic bytes check.
 *  5. Build storage path nuevo.
 *  6. Upload via service-role.
 *  7. UPDATE consultoras.logo_storage_path (RLS UPDATE owner-only).
 *  8. Si UPDATE OK y habia logo previo, delete del path anterior.
 *  9. Si UPDATE fallido, rollback storage delete del path nuevo.
 */

type ErrorBody = { code: string; message: string };

function errorResponse(status: number, body: ErrorBody): Response {
  return Response.json(body, { status });
}

export async function POST(request: NextRequest): Promise<Response> {
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
  if (consultora.role !== 'owner') {
    return errorResponse(403, {
      code: 'FORBIDDEN',
      message: 'Solo el owner puede modificar el branding.',
    });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    logger.warn({ err: String(err), userId: user.id }, 'logo_upload: FormData parse fallo');
    return errorResponse(400, { code: 'INVALID_INPUT', message: 'Cuerpo invalido.' });
  }

  const file = formData.get('file');
  if (!(file instanceof Blob)) {
    return errorResponse(400, { code: 'INVALID_INPUT', message: 'Falta el archivo de logo.' });
  }

  const claimedMime = file.type || 'application/octet-stream';
  const mimeError = validateLogoMime(claimedMime);
  if (mimeError) {
    return errorResponse(415, { code: mimeError.code, message: mimeError.message });
  }
  const sizeError = validateLogoSize(file.size);
  if (sizeError) {
    return errorResponse(413, { code: sizeError.code, message: sizeError.message });
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (err) {
    logger.error({ err: String(err), userId: user.id }, 'logo_upload: arrayBuffer fallo');
    return errorResponse(500, { code: 'INTERNAL_ERROR', message: 'No se pudo leer el archivo.' });
  }

  if (!magicBytesMatch(bytes, claimedMime)) {
    return errorResponse(415, {
      code: 'MAGIC_BYTES_MISMATCH',
      message: 'El contenido del archivo no coincide con su tipo declarado.',
    });
  }

  let processedBuffer: Buffer;
  let finalMime: string;
  try {
    const processed = await processLogoImage(Buffer.from(bytes));
    processedBuffer = processed.buffer;
    finalMime = processed.mime;
  } catch (err) {
    logger.warn(
      { err: String(err), userId: user.id, mime: claimedMime },
      'logo_upload: sharp fallo',
    );
    return errorResponse(422, {
      code: 'UNSUPPORTED_MIME',
      message: 'No se pudo procesar la imagen. Probá con otro archivo.',
    });
  }

  // Path previo (para cleanup post-update).
  const { data: prev } = await supabase
    .from('consultoras')
    .select('logo_storage_path')
    .eq('id', consultora.id)
    .maybeSingle();
  const previousPath = prev?.logo_storage_path ?? null;

  const newPath = buildLogoPath({ consultoraId: consultora.id, mime: finalMime });
  const admin = createServiceRoleClient();

  const { error: uploadError } = await uploadLogoToStorage(admin, {
    path: newPath,
    bytes: processedBuffer,
    contentType: finalMime,
  });
  if (uploadError) {
    logger.error(
      { err: uploadError.message, consultoraId: consultora.id, newPath },
      'logo_upload: storage upload fallo',
    );
    return errorResponse(500, { code: 'STORAGE_ERROR', message: 'No se pudo subir el logo.' });
  }

  const { data: updated, error: updateError } = await supabase
    .from('consultoras')
    .update({ logo_storage_path: newPath })
    .eq('id', consultora.id)
    .select('id, logo_storage_path');

  if (updateError || !updated || updated.length === 0) {
    // Rollback: borrar el storage object nuevo (no tocamos el previo).
    void deleteLogoFromStorage(admin, newPath).catch(() => {});
    logger.error(
      { err: updateError, consultoraId: consultora.id, newPath },
      'logo_upload: DB update fallo, rollback storage',
    );
    return errorResponse(500, {
      code: 'INTERNAL_ERROR',
      message: 'Error actualizando la consultora.',
    });
  }

  // Cleanup del logo anterior. await para que el response refleje el estado
  // final del bucket. Si el delete falla o no remueve nada, loggeamos pero
  // NO bloqueamos el response — el state nuevo ya esta committed en DB,
  // perder el cleanup deja un huerfano que el cron T-024-FU1 va a recoger.
  if (previousPath) {
    const { error: cleanupError, removed } = await deleteLogoFromStorage(admin, previousPath);
    if (cleanupError || removed === 0) {
      logger.warn(
        { err: cleanupError?.message, removed, consultoraId: consultora.id, previousPath },
        'logo_upload: cleanup logo previo no removio el objeto',
      );
    }
  }

  logger.info(
    {
      consultoraId: consultora.id,
      userId: user.id,
      newPath,
      previousPath,
      sizeBytes: processedBuffer.length,
      mime: finalMime,
    },
    'consultora_logo_updated',
  );

  revalidatePath('/settings/consultora');

  return Response.json({ ok: true, logoStoragePath: newPath }, { status: 201 });
}
