'use server';

import type { UpdateNotificationPrefsInput } from './schema';
import { revalidatePath } from 'next/cache';

import { logger } from '@/shared/observability/logger';
import { createClient } from '@/shared/supabase/server';

import { computeMutedUntil } from './mute-helpers';
import { updateNotificationPrefsSchema } from './schema';

/**
 * T-035 · Server action que actualiza las preferencias de notificacion del
 * user logueado (toggle email + mute temporal global).
 *
 * Telegram y Push son forzados a `enabled=false` aca — T-033/T-034 no estan
 * implementados, si dejaramos `enabled=true` el dispatcher T-031 intentaria
 * enviar y fallaria con `NO_CHANNEL_IMPL_T033` / `NO_CHANNEL_IMPL_T034`.
 *
 * Mute es global: UPSERT bulk de los 3 canales con el mismo `muted_until`
 * computado. Mute granular per-canal queda como follow-up si Lautaro lo pide.
 *
 * RLS de `notification_channel_prefs` permite SELECT/INSERT/UPDATE propios
 * (`user_id = auth.uid()`); UPSERT con cliente authed respeta el gate sin
 * necesidad de service-role.
 */
export type UpdateNotificationPrefsResult =
  | { ok: true }
  | {
      ok: false;
      code: 'INVALID_INPUT' | 'UNAUTHENTICATED' | 'INTERNAL_ERROR';
      message: string;
      fieldErrors?: Record<string, string[]>;
    };

export async function updateNotificationPrefsAction(
  input: UpdateNotificationPrefsInput,
): Promise<UpdateNotificationPrefsResult> {
  const parsed = updateNotificationPrefsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Datos invalidos.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: 'UNAUTHENTICATED', message: 'Inicia sesion.' };

  const now = new Date();
  const mutedUntil = computeMutedUntil(parsed.data.mute, now);

  // Defensa: si el user envia type='until' con una fecha del pasado (race entre
  // navegacion + submit, o tab abierta dias), el `computeMutedUntil` devuelve
  // un ISO ya vencido. El dispatcher lo ignoraria igual (porque `new Date(u) > now`
  // es false), pero persistirlo da UX confusa ("Pausadas hasta ayer"). Lo
  // normalizamos a null silenciosamente.
  const effectiveMutedUntil =
    mutedUntil !== null && new Date(mutedUntil).getTime() > now.getTime() ? mutedUntil : null;

  // UPSERT bulk a los 3 canales. `onConflict: 'user_id,channel'` apunta a la
  // UNIQUE constraint de T-031. Si el row no existe (telegram/push nunca creados
  // por el trigger default que solo crea email), se inserta; si existe, se updatea.
  const rows = [
    {
      user_id: user.id,
      channel: 'email' as const,
      enabled: parsed.data.emailEnabled,
      muted_until: effectiveMutedUntil,
    },
    {
      user_id: user.id,
      channel: 'telegram' as const,
      enabled: false,
      muted_until: effectiveMutedUntil,
    },
    {
      user_id: user.id,
      channel: 'push' as const,
      enabled: false,
      muted_until: effectiveMutedUntil,
    },
  ];

  const { error } = await supabase
    .from('notification_channel_prefs')
    .upsert(rows, { onConflict: 'user_id,channel' });

  if (error) {
    logger.error({ err: error, userId: user.id }, 'updateNotificationPrefsAction: upsert fallo');
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Error guardando preferencias.' };
  }

  revalidatePath('/settings/notificaciones');
  return { ok: true };
}
