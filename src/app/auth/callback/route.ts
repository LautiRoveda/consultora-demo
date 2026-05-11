import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { logger } from '@/shared/observability/logger';
import { createClient } from '@/shared/supabase/server';

/**
 * Callback handler para email confirmation (T-012) y magic link (T-013 futuro).
 *
 * Supabase redirige al usuario acá tras click en el link del email con un
 * `code` en query. Hacemos `exchangeCodeForSession(code)` para establecer la
 * sesión (escribe cookies via el server client) y redirigimos al login.
 *
 * NOTA: este route handler vive fuera del route group `(auth)` para que la URL
 * pública sea literal `/auth/callback`, que es la que configuramos en
 * Supabase dashboard → Authentication → URL Configuration → Redirect URLs.
 *
 * Si el code está vencido, fue usado, o no viene → redirigimos a
 * `/login?error=callback_failed` con banner amistoso. Loggeamos el detalle a
 * Sentry.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

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

  // Sesión establecida. T-013 va a redirigir a /dashboard directo desde acá si
  // el user ya tiene tenant + claim. Por ahora redirigimos a /login con banner
  // de "confirmado" para que el user complete el primer login real.
  return NextResponse.redirect(`${origin}/login?confirmed=1`);
}
