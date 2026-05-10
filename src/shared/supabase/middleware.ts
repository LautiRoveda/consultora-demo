import 'server-only';

import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';

import { env } from '@/env';

/**
 * Helper de middleware: refresca la sesión Supabase en cada request.
 *
 * Si el access token está vencido, `getUser()` dispara un refresh con el
 * refresh token y actualiza las cookies en `supabaseResponse`. Si no hay
 * sesión, `getUser()` devuelve `{ data: { user: null } }` sin error — la
 * landing pública sigue funcionando igual.
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
  await supabase.auth.getUser();

  return supabaseResponse;
}
