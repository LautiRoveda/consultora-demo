import 'server-only';

import { NextResponse } from 'next/server';

import { createClient } from '@/shared/supabase/server';

/**
 * T-033 · GET /api/telegram/status — polling endpoint para el dialog
 * de vinculación.
 *
 * El UI client poll-ea este endpoint cada 3 seg (max 5 min) mientras el
 * modal está abierto + state = 'code_ready', para detectar cuándo
 * Telegram completó el /start y la row pasó a linked_at != null.
 *
 * Estados del response:
 *  - `{ state: 'unauthenticated' }` (HTTP 401) — sin sesión.
 *  - `{ state: 'unlinked' }` — sin row o expirado/unlinked.
 *  - `{ state: 'pending', expiresAt }` — código generado, esperando /start.
 *  - `{ state: 'linked', username, since, blocked }` — vinculación activa.
 *
 * Headers: `Cache-Control: no-store` para que el polling no sirva
 * respuesta cacheada (por defecto Next.js no cachea GET handlers con
 * `dynamic = 'force-dynamic'`, pero defensivo extra).
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function noCacheHeaders() {
  return {
    'Cache-Control': 'no-store, max-age=0',
    'X-Robots-Tag': 'noindex',
  } as const;
}

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { state: 'unauthenticated' },
      { status: 401, headers: noCacheHeaders() },
    );
  }

  const { data: sub } = await supabase
    .from('telegram_subscriptions')
    .select(
      'telegram_username, link_code, link_code_expires_at, linked_at, unlinked_at, blocked_count',
    )
    .eq('user_id', user.id)
    .maybeSingle();

  const now = new Date();

  if (!sub) {
    return NextResponse.json({ state: 'unlinked' }, { headers: noCacheHeaders() });
  }

  if (sub.linked_at && !sub.unlinked_at) {
    return NextResponse.json(
      {
        state: 'linked',
        username: sub.telegram_username,
        since: sub.linked_at,
        blocked: sub.blocked_count >= 3,
      },
      { headers: noCacheHeaders() },
    );
  }

  if (
    sub.link_code &&
    sub.link_code_expires_at &&
    new Date(sub.link_code_expires_at).getTime() > now.getTime()
  ) {
    return NextResponse.json(
      {
        state: 'pending',
        expiresAt: sub.link_code_expires_at,
      },
      { headers: noCacheHeaders() },
    );
  }

  return NextResponse.json({ state: 'unlinked' }, { headers: noCacheHeaders() });
}
