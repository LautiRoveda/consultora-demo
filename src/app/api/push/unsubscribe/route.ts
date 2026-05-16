import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import { logger } from '@/shared/observability/logger';
import { PushUnsubscribeInputSchema } from '@/shared/push/types';
import { createClient } from '@/shared/supabase/server';
import { createServiceRoleClient } from '@/shared/supabase/service-role';

/**
 * T-034 · DELETE /api/push/unsubscribe.
 *
 * El client (PushChannelRow) llama tras click "Desactivar en este dispositivo".
 * Body: `{ endpoint: string }`.
 *
 * Flow:
 *  1. Auth via session. Sin sesión → 401.
 *  2. Parse Zod del body. Inválido → 400.
 *  3. DELETE WHERE user_id = auth.uid() AND endpoint = $1.
 *     RLS de SELECT/DELETE en push_subscriptions garantiza que el user solo
 *     puede borrar sus propias rows. Si el endpoint no existe (caso edge:
 *     re-click del botón después de delete OK) → 0 rows afectados,
 *     respondemos 200 idempotente.
 *  4. Si tras el DELETE quedan 0 subs del user → auto-disable pref push.
 *     Si quedan otras subs en otros devices → preservar pref enabled
 *     (mismo user en otros browsers todavía quiere recibir).
 *
 * Audit trigger captura el DELETE del paso 3 (vía service-role lookup post
 * del row antes de borrar, no — el delete client-side ya dispara el trigger).
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  // 1. Auth.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, code: 'UNAUTHENTICATED' }, { status: 401 });
  }

  // 2. Parse body.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: 'INVALID_JSON' }, { status: 400 });
  }

  const parsed = PushUnsubscribeInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        code: 'INVALID_INPUT',
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      },
      { status: 400 },
    );
  }

  // 3. DELETE via client authed (RLS filtra cross-user).
  const { data: deleted, error: delErr } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('user_id', user.id)
    .eq('endpoint', parsed.data.endpoint)
    .select('id');

  if (delErr) {
    logger.error({ err: delErr, userId: user.id }, 'push unsubscribe: delete falló');
    return NextResponse.json(
      { ok: false, code: 'STORAGE_ERROR', message: delErr.message },
      { status: 500 },
    );
  }

  const rowsDeleted = deleted?.length ?? 0;

  // 4. Auto-disable pref si era la última sub del user.
  //    Usamos service-role para count (UPDATE de pref también via service-role
  //    por consistency con T-033 unlinkTelegramAction).
  if (rowsDeleted > 0) {
    const admin = createServiceRoleClient();
    const { count } = await admin
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    if ((count ?? 0) === 0) {
      await admin
        .from('notification_channel_prefs')
        .upsert(
          { user_id: user.id, channel: 'push', enabled: false },
          { onConflict: 'user_id,channel' },
        );
      logger.info({ userId: user.id }, 'push: última sub borrada → pref auto-disabled');
    }
  }

  return NextResponse.json({ ok: true, deletedCount: rowsDeleted }, { status: 200 });
}
