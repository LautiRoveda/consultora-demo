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
 * Post-T-033 — el canal telegram se gobierna por su propio flow (linkeo
 * via webhook + unlink action), no por este form. NO sobrescribimos
 * `telegram.enabled` ni `push.enabled` desde acá: el webhook hace
 * UPSERT enabled=true al linkear, y `unlinkTelegramAction` hace
 * UPSERT enabled=false al desvincular. Si este action lo sobreescribiera,
 * el flow se rompería (cada save de mute pisaría el toggle del linkeo).
 *
 * Mute es global: UPDATE del `muted_until` en los 3 canales del user.
 * Solo el row de email se UPSERTea (porque emailEnabled puede cambiar);
 * los rows de telegram/push se UPDATE-an solo si existen (no se crean
 * acá — los crea el trigger T-031 para email y los actions de T-033/T-034
 * para telegram/push). Mute granular per-canal queda como follow-up.
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

  // UPSERT del row email (puede cambiar emailEnabled + muted_until).
  const { error: emailErr } = await supabase.from('notification_channel_prefs').upsert(
    {
      user_id: user.id,
      channel: 'email' as const,
      enabled: parsed.data.emailEnabled,
      muted_until: effectiveMutedUntil,
    },
    { onConflict: 'user_id,channel' },
  );

  if (emailErr) {
    logger.error(
      { err: emailErr, userId: user.id },
      'updateNotificationPrefsAction: upsert email fallo',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Error guardando preferencias.' };
  }

  // UPDATE muted_until para telegram + push del mismo user, SIN tocar
  // `enabled` (gobernado por el flow de cada canal — webhook telegram,
  // future push setup). Si los rows no existen, este UPDATE es no-op
  // (0 rows afectados) — no creamos rows con enabled=false innecesarios.
  const { error: muteErr } = await supabase
    .from('notification_channel_prefs')
    .update({ muted_until: effectiveMutedUntil })
    .eq('user_id', user.id)
    .in('channel', ['telegram', 'push']);

  if (muteErr) {
    logger.error(
      { err: muteErr, userId: user.id },
      'updateNotificationPrefsAction: update mute telegram/push fallo',
    );
    // Email ya fue persistido OK — no fallamos el action entero por esto.
    // El mute de telegram/push queda desincronizado del de email; aceptable
    // tradeoff porque es defensa secundaria (dispatcher chequea muted_until
    // por canal pero el del email es el que el user ve en la UI).
  }

  revalidatePath('/settings/notificaciones');
  return { ok: true };
}
