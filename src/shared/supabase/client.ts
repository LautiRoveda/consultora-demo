import type { Database } from './types';
import { createBrowserClient } from '@supabase/ssr';

/**
 * Cliente Supabase para Client Components (`'use client'`).
 *
 * Lee `NEXT_PUBLIC_*` directo desde `process.env` en lugar de importar
 * `@/env` porque ese módulo es server-only (`import 'server-only'`) y un
 * Client Component que lo importe rompe el build.
 *
 * Las vars `NEXT_PUBLIC_*` están inlineadas por Next.js en el bundle del
 * cliente en build time: si faltan, el bundle queda con `undefined` y
 * cualquier llamada falla en runtime — la "validación" se hace de hecho en
 * build (no hay producción sin esas vars seteadas).
 *
 * Uso:
 * ```tsx
 * 'use client'
 * import { createClient } from '@/shared/supabase/client'
 *
 * export function MiComponente() {
 *   const supabase = createClient()
 *   // ... realtime subscriptions, browser-only flows, etc.
 * }
 * ```
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
