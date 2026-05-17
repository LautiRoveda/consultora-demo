import type { ChannelPrefRow } from './NotificacionesSettingsView';
import type { TelegramRowState } from './TelegramChannelRow';
import { redirect } from 'next/navigation';

import { createClient } from '@/shared/supabase/server';

import { NotificacionesSettingsView } from './NotificacionesSettingsView';

/**
 * T-035 · Server page de Settings/Notificaciones.
 *
 * Carga las 3 prefs del user (puede haber 1, 2 o 3 rows segun T-031 trigger
 * default + interacciones previas con la action). Para canales sin row,
 * proveemos defaults safe que matchean lo que el dispatcher T-031 asume:
 *  - email default `enabled=true` (trigger T-031 lo crea al insert de
 *    consultora_members; si por algun motivo no corrio, el dispatcher tambien
 *    defaultea a true para email).
 *  - telegram/push default `enabled=false` (no implementados).
 *
 * Las prefs son per-user, NO per-consultora — la pagina NO requiere
 * `getCurrentConsultora`. El layout `(app)` ya gateo la sesion + membership.
 */
export default async function NotificacionesSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [prefsRes, tgRes] = await Promise.all([
    supabase
      .from('notification_channel_prefs')
      .select('channel, enabled, muted_until')
      .eq('user_id', user.id),
    supabase
      .from('telegram_subscriptions')
      .select(
        'telegram_username, link_code, link_code_expires_at, linked_at, unlinked_at, blocked_count',
      )
      .eq('user_id', user.id)
      .maybeSingle(),
  ]);

  const byChannel = new Map<string, ChannelPrefRow>(
    (prefsRes.data ?? []).map((p) => [p.channel, p as ChannelPrefRow]),
  );
  const initialPrefs = {
    email: byChannel.get('email') ?? {
      channel: 'email' as const,
      enabled: true,
      muted_until: null,
    },
    telegram: byChannel.get('telegram') ?? {
      channel: 'telegram' as const,
      enabled: false,
      muted_until: null,
    },
    push: byChannel.get('push') ?? {
      channel: 'push' as const,
      enabled: false,
      muted_until: null,
    },
  };

  // T-033 — derivar el estado del row Telegram a partir de telegram_subscriptions.
  const now = new Date();
  const telegramInitial: TelegramRowState = (() => {
    const sub = tgRes.data;
    if (!sub) return { kind: 'unlinked' };
    if (sub.linked_at && !sub.unlinked_at) {
      return {
        kind: 'linked',
        username: sub.telegram_username,
        blocked: sub.blocked_count >= 3,
      };
    }
    if (
      sub.link_code &&
      sub.link_code_expires_at &&
      new Date(sub.link_code_expires_at).getTime() > now.getTime()
    ) {
      return { kind: 'pending' };
    }
    return { kind: 'unlinked' };
  })();

  // T-034 — VAPID public key inlined al client. NEXT_PUBLIC_* prefix garantiza
  // que Next la sustituye en build time (sin runtime fetch). No leemos de
  // src/env.ts (server-only) — la pasamos como prop al view.
  // El client la convierte a Uint8Array via urlBase64ToUint8Array para
  // pushManager.subscribe().
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

  return (
    <NotificacionesSettingsView
      userEmail={user.email ?? ''}
      initialPrefs={initialPrefs}
      telegramInitialState={telegramInitial}
      vapidPublicKey={vapidPublicKey}
    />
  );
}
