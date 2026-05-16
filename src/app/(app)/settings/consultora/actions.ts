'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

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

// ---------------------------------------------------------------------------
// updateAutoCreateEventToggleAction (T-036)
// ---------------------------------------------------------------------------

export type UpdateAutoCreateEventToggleResult =
  | { ok: true; enabled: boolean }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: Record<string, string[]>; message: string }
  | {
      ok: false;
      code: 'UNAUTHENTICATED' | 'NO_CONSULTORA' | 'FORBIDDEN' | 'INTERNAL_ERROR';
      message: string;
    };

const toggleSchema = z.object({
  enabled: z.boolean({ message: 'Valor inválido.' }),
});

/**
 * T-036 · Actualiza `consultoras.auto_create_event_on_sign`.
 *
 * Owner-only: la columna afecta a TODOS los users del tenant cuando publican
 * un informe. Patron canonico T-024 (logo es config tenant-wide, mismo gate).
 *
 * RLS WITH CHECK de `consultoras_update_own_owner` (T-011) valida que solo el
 * owner puede UPDATE; el gate explicito aca es defensa en profundidad +
 * permite devolver FORBIDDEN con mensaje en lugar de INTERNAL_ERROR.
 */
export async function updateAutoCreateEventToggleAction(
  enabled: boolean,
): Promise<UpdateAutoCreateEventToggleResult> {
  const parsed = toggleSchema.safeParse({ enabled });
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.map((p) => String(p)).join('.') || '_';
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { ok: false, code: 'INVALID_INPUT', fieldErrors, message: 'Datos inválidos.' };
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

  if (consultora.role !== 'owner') {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'Solo el owner puede modificar el workflow de la consultora.',
    };
  }

  const { data: updated, error } = await supabase
    .from('consultoras')
    .update({ auto_create_event_on_sign: parsed.data.enabled })
    .eq('id', consultora.id)
    .select('id');

  if (error) {
    logger.error(
      { err: error, consultoraId: consultora.id, userId: user.id, enabled: parsed.data.enabled },
      'updateAutoCreateEventToggleAction: update fallo',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Error actualizando el workflow.' };
  }
  if (!updated || updated.length === 0) {
    // RLS WITH CHECK rechazo (race entre el SELECT defensivo y el UPDATE).
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'Solo el owner puede modificar el workflow de la consultora.',
    };
  }

  revalidatePath('/settings/consultora');
  // Tambien invalidamos /informes/[id]/editar porque el toggle determina si
  // PublishButton dispara silent path vs modal en el siguiente publish.
  revalidatePath('/informes', 'layout');

  logger.info(
    {
      consultoraId: consultora.id,
      userId: user.id,
      enabled: parsed.data.enabled,
    },
    'consultora_auto_create_event_toggle_updated',
  );

  return { ok: true, enabled: parsed.data.enabled };
}
