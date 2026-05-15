import type { ChannelPrefRow } from './NotificacionesSettingsView';
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

  const { data: prefs } = await supabase
    .from('notification_channel_prefs')
    .select('channel, enabled, muted_until')
    .eq('user_id', user.id);

  const byChannel = new Map<string, ChannelPrefRow>(
    (prefs ?? []).map((p) => [p.channel, p as ChannelPrefRow]),
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

  return <NotificacionesSettingsView userEmail={user.email ?? ''} initialPrefs={initialPrefs} />;
}
