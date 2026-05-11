import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { logger } from '@/shared/observability/logger';
import { createClient } from '@/shared/supabase/server';

/**
 * Callback handler para email confirmation (T-012 signup) y magic link (T-013).
 *
 * Supabase redirige al usuario acá tras click en el link del email con un
 * `code` en query. Hacemos `exchangeCodeForSession(code)` para establecer la
 * sesión (escribe cookies via el server client) y redirigimos según el
 * query param `?next=<path>` que setea cada flow:
 *
 * - signup confirm (T-012):     `?next=/login&from=signup`
 * - magic link login (T-013):   `?next=/dashboard&from=magic_link`
 * - password recovery (T-014):  `?next=/reset-password&from=recovery` (futuro)
 *
 * `next` se sanitiza contra una allowlist estricta para prevenir
 * open-redirect attacks. Cualquier valor desconocido cae al default
 * `/login?confirmed=1` (también el caso de emails T-012 ya enviados sin
 * `next` — backward compatible).
 *
 * Este route handler vive fuera del route group `(auth)` para que la URL
 * pública sea literal `/auth/callback`, que es la que configuramos en
 * Supabase dashboard → Authentication → URL Configuration → Redirect URLs.
 */
const NEXT_ALLOWLIST = ['/dashboard', '/login'] as const;

function sanitizeNext(raw: string | null): string | null {
  if (!raw) return null;
  // Defensa anti open-redirect: paths internos, sin `//` ni protocol.
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  // Allowlist estricta.
  return (NEXT_ALLOWLIST as readonly string[]).includes(raw) ? raw : null;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = sanitizeNext(searchParams.get('next'));

  if (!code) {
    logger.warn({ url: request.url }, 'auth/callback invocado sin code');
    return NextResponse.redirect(`${origin}/login?error=callback_failed`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    logger.error({ error, code: code.slice(0, 8) }, 'exchangeCodeForSession falló');
    return NextResponse.redirect(`${origin}/login?error=callback_failed`);
  }

  // Routing post-exchange según `?next=`:
  // - magic link → /dashboard (usuario ya logueado).
  // - signup confirm → /login?confirmed=1 (usuario debe ingresar manualmente).
  // - backward compat (sin next) → /login?confirmed=1.
  if (next === '/dashboard') {
    return NextResponse.redirect(`${origin}/dashboard`);
  }
  return NextResponse.redirect(`${origin}/login?confirmed=1`);
}
