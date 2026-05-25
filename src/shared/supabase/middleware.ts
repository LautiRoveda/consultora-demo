import 'server-only';

import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';

import { env } from '@/env';

/**
 * C7 audit · defense-in-depth API guard.
 *
 * PUBLIC_API_PREFIXES: prefijos donde TODAS las routes son públicas (webhooks
 *   con su propio secret check, cron con bearer, health, push subs públicas,
 *   test-error en dev, Sentry monitoring tunnel).
 * PUBLIC_API_EXACT: paths exactos públicos por razones legacy. dispatch-reminder
 *   vive bajo /api/calendar/ porque se creó en T-026..T-037 antes de la
 *   convention /api/cron/. Refactorar la URL implica update pg_cron schedule
 *   + EasyPanel config — scope creep no necesario para este chore. Path
 *   exacto evita que `/api/calendar/*` nuevas queden públicas por default.
 *
 * Convención forward: API privada por default. Para hacer una route nueva
 * pública, sumar al PUBLIC_API_PREFIXES (si toda la familia es pública) o
 * a PUBLIC_API_EXACT (si es un caso aislado). Ver docs/lessons-learned.md.
 */
const PUBLIC_API_PREFIXES = /^\/api\/(health|webhooks|cron|push|test-error|monitoring)(\/|$)/;
const PUBLIC_API_EXACT = new Set<string>(['/api/calendar/dispatch-reminder']);

function isPublicApi(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.test(pathname) || PUBLIC_API_EXACT.has(pathname);
}

/**
 * Helper de middleware: refresca la sesión Supabase en cada request +
 * bloquea API privadas sin sesión (defense-in-depth, C7 audit).
 *
 * Si el access token está vencido, `getUser()` dispara un refresh con el
 * refresh token y actualiza las cookies en `supabaseResponse`. Si no hay
 * sesión, `getUser()` devuelve `{ data: { user: null } }` sin error — la
 * landing pública sigue funcionando igual.
 *
 * Para requests `/api/*` que NO matchean la whitelist, si no hay user, el
 * middleware corta con 401 antes de invocar el route handler. Esto es defensa
 * contra regression: si un PR futuro omite el `auth.getUser()` check en el
 * handler, la route NO queda públicamente accesible.
 *
 * El entry point está en `src/proxy.ts` (convención stable de Next.js 16,
 * reemplaza al deprecated `middleware.ts`) que invoca a esta función con el
 * matcher de Next.js.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  // CRÍTICO: getUser() debe llamarse antes de cualquier código que use la
  // sesión. Refresca tokens vencidos y actualiza las cookies.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // C7 audit · defense-in-depth. API privada sin user → 401 acá, no llega
  // al handler. La whitelist permite webhooks/cron (que validan su propio
  // secret) y la landing pública (que NO matchea /api/*).
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith('/api/') && !isPublicApi(pathname) && !user) {
    return NextResponse.json(
      { code: 'UNAUTHENTICATED', message: 'Iniciá sesión.' },
      { status: 401 },
    );
  }

  return supabaseResponse;
}
