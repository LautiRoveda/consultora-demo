import 'server-only';

import type { Database } from './types';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import { env } from '@/env';

/**
 * Cliente Supabase con privilegios admin.
 *
 * **Bypass total de RLS.** Usa la service role key y no respeta las policies
 * de Postgres — accede a todas las tablas de todas las consultoras.
 *
 * Reservado **exclusivamente** para:
 * - Jobs programados (pg_cron, queue workers).
 * - Webhooks externos (Mercado Pago, Telegram) que no traen sesión de usuario.
 * - Migraciones de datos / scripts de admin server-side.
 *
 * **NUNCA exponer al cliente.** Si una page o componente lo importa, este
 * módulo tira en build time gracias a `import 'server-only'`. Adicionalmente,
 * el step "Verify service_role not in client bundle" del CI verifica el
 * bundle final como defensa en profundidad.
 *
 * `persistSession: false` y `autoRefreshToken: false` evitan que el SDK
 * intente guardar la sesión service-role en cookies o storage — no aplica
 * para este caso de uso.
 */
export function createServiceRoleClient() {
  return createSupabaseClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}
