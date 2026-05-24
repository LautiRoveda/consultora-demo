import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import { logger } from '@/shared/observability/logger';
import {
  buildSubscriptionDbRow,
  extractSubscriptionFromBody,
} from '@/shared/push/subscription-helpers';
import { createClient } from '@/shared/supabase/server';
import { createServiceRoleClient } from '@/shared/supabase/service-role';

/**
 * T-034 · POST /api/push/subscribe.
 *
 * El client (PushChannelRow) llama tras pushManager.subscribe() exitoso.
 * Body: `{ endpoint: string, keys: { p256dh: string, auth: string } }`.
 *
 * Flow:
 *  1. Auth via Supabase session cookie. Sin sesión → 401.
 *  2. Parse Zod del body. Inválido → 400.
 *  3. Capture User-Agent (diagnóstico, best-effort).
 *  4. UPSERT en push_subscriptions con onConflict (user_id, endpoint).
 *     Re-subscribe del mismo endpoint refresca last_seen_at (idempotente).
 *  5. UPSERT pref push enabled=true (auto-enable on subscribe — Q2 cerrada).
 *     Patrón análogo al `/start` Telegram T-033.
 *  6. Return 201 con id de la sub.
 *
 * Audit trigger captura el INSERT del paso 4.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
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

  const parsed = extractSubscriptionFromBody(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, code: 'INVALID_INPUT', issues: parsed.issues },
      { status: 400 },
    );
  }

  // 3. UA capture.
  const userAgent = request.headers.get('user-agent');

  // 4. UPSERT push_subscriptions via service-role.
  //    Razón: UPDATE en push_subscriptions es default-deny para authenticated
  //    (decisión T-027 patrón: solo sender service-role updatea last_seen_at).
  //    Un UPSERT con onConflict, si el row existe, dispara UPDATE → RLS
  //    bloquea → error 500. Como el user.id viene del session (verificado
  //    arriba) y el row se construye server-side (no del body), es seguro
  //    usar admin client.
  // Cross-tenant defense audited AUD-003: tabla per-user (no per-tenant);
  // user_id sourced from verified session, no body. N/A cross-tenant.
  const admin = createServiceRoleClient();
  const row = buildSubscriptionDbRow(parsed.data, user.id, userAgent);
  const { data: upserted, error: upsertErr } = await admin
    .from('push_subscriptions')
    .upsert(row, { onConflict: 'user_id,endpoint' })
    .select('id')
    .single();

  if (upsertErr || !upserted) {
    logger.error({ err: upsertErr, userId: user.id }, 'push subscribe: upsert falló');
    return NextResponse.json(
      { ok: false, code: 'STORAGE_ERROR', message: upsertErr?.message },
      { status: 500 },
    );
  }

  // 5. Auto-enable pref push (Q2 cerrada). Mismo admin client.
  await admin
    .from('notification_channel_prefs')
    .upsert(
      { user_id: user.id, channel: 'push', enabled: true },
      { onConflict: 'user_id,channel' },
    );

  logger.info(
    { userId: user.id, subId: upserted.id, hasUA: Boolean(userAgent) },
    'push subscribed',
  );

  return NextResponse.json({ ok: true, subscriptionId: upserted.id }, { status: 201 });
}
