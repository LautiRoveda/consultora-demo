'use server';

import { revalidatePath } from 'next/cache';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { logger } from '@/shared/observability/logger';
import { deleteLogoFromStorage } from '@/shared/storage/logo';
import { createClient } from '@/shared/supabase/server';
import { createServiceRoleClient } from '@/shared/supabase/service-role';

/**
 * T-024 · Server actions de Settings/Consultora.
 *
 * Upload va por route handler (multipart). Aca solo `removeConsultoraLogoAction`.
 * Owner-only por gate explicito + RLS (column update via auth client).
 */

export type RemoveConsultoraLogoResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'UNAUTHENTICATED'
        | 'NO_CONSULTORA'
        | 'FORBIDDEN'
        | 'NOT_FOUND'
        | 'STORAGE_ERROR'
        | 'INTERNAL_ERROR';
      message: string;
    };

export async function removeConsultoraLogoAction(): Promise<RemoveConsultoraLogoResult> {
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
  if (consultora.role !== 'owner') {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'Solo el owner puede modificar el branding.',
    };
  }

  // Cargar path actual (necesario para eliminar de storage).
  const { data: row } = await supabase
    .from('consultoras')
    .select('logo_storage_path')
    .eq('id', consultora.id)
    .maybeSingle();
  if (!row) return { ok: false, code: 'NOT_FOUND', message: 'Consultora no encontrada.' };
  if (!row.logo_storage_path) {
    // No hay logo — idempotent success.
    return { ok: true };
  }

  // Storage primero, despues DB (mismo patron que delete attachment).
  const admin = createServiceRoleClient();
  const { error: storageError } = await deleteLogoFromStorage(admin, row.logo_storage_path);
  if (storageError) {
    logger.error(
      { err: storageError.message, consultoraId: consultora.id, path: row.logo_storage_path },
      'removeConsultoraLogoAction: storage delete fallo',
    );
    return { ok: false, code: 'STORAGE_ERROR', message: 'Error eliminando el logo.' };
  }

  const { data: updated, error } = await supabase
    .from('consultoras')
    .update({ logo_storage_path: null })
    .eq('id', consultora.id)
    .select('id');

  if (error) {
    logger.error(
      { err: error, consultoraId: consultora.id, userId: user.id },
      'removeConsultoraLogoAction: update fallo',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Error actualizando la consultora.' };
  }
  if (!updated || updated.length === 0) {
    return { ok: false, code: 'FORBIDDEN', message: 'No tenés permiso para esta acción.' };
  }

  revalidatePath('/settings/consultora');
  return { ok: true };
}
