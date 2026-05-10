import 'server-only';

import type { Database } from './types';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { env } from '@/env';

/**
 * Cliente Supabase para Server Components, Server Actions y Route Handlers.
 *
 * Lee/escribe cookies del request actual de Next.js, así que cada llamada hace
 * passthrough de la sesión del usuario. RLS de Postgres se aplica en base al
 * JWT del usuario logueado.
 *
 * Uso:
 * ```ts
 * 'use server'
 * import { createClient } from '@/shared/supabase/server'
 *
 * export async function miAction() {
 *   const supabase = await createClient()
 *   const { data: { user } } = await supabase.auth.getUser()
 *   if (!user) throw new Error('UNAUTHORIZED')
 *   // ...
 * }
 * ```
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // `setAll` puede invocarse desde un Server Component puro (read-only
            // cookies). Es seguro ignorar el error si el proxy está refrescando
            // sesiones — que es nuestro caso (ver `src/proxy.ts`).
          }
        },
      },
    },
  );
}
