import { NextResponse } from 'next/server';

import { createServiceRoleClient } from '@/shared/supabase/service-role';

/**
 * T-081 · GET /api/health
 *
 * Endpoint público de health para synthetic monitoring (T-083 va a pegarle
 * cada 5 min). NO requiere auth. NO rate-limited (synthetic monitor manda
 * ~288 req/day por monitor — sin riesgo de cuota Upstash).
 *
 * Chequea SOLO Supabase (sin Anthropic/Resend/Telegram/Upstash) — los otros
 * providers cuestan tokens/API calls + sus failures las captura Sentry. Si
 * algún provider degrada recurrente, sumar check vía T-081-FU3.
 *
 * Response shape MÍNIMO (decisión Lautaro YAGNI):
 *   { ok, version, supabase, uptime_seconds, timestamp }
 *
 * Agregar fields a JSON es backward-compat (consumers ignoran extras),
 * removerlos es break. Si T-083 termina necesitando `supabase_latency_ms`,
 * se suma en ese ticket. Anti-test verifica el shape exacto.
 */

// Node runtime: necesario para `process.uptime()` + `AbortSignal.timeout()`.
// Default edge runtime rompería ambos.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // Supabase check con timeout 3s vía AbortSignal.timeout() (Node 18+).
  // One-liner sin manual cleanup — el setTimeout interno auto-clears.
  let supabaseStatus: 'ok' | 'down' = 'down';
  try {
    const admin = createServiceRoleClient();
    // head:true devuelve count metadata sin payload — query super lightweight.
    // Usar `consultoras` (tabla core, RLS bypass via service-role).
    const { error } = await admin
      .from('consultoras')
      .select('id', { count: 'exact', head: true })
      .limit(1)
      .abortSignal(AbortSignal.timeout(3000));
    supabaseStatus = error ? 'down' : 'ok';
  } catch {
    // AbortError (timeout) o network error → down.
    supabaseStatus = 'down';
  }

  const ok = supabaseStatus === 'ok';
  const body = {
    ok,
    version: process.env.GIT_SHA ?? 'dev',
    supabase: supabaseStatus,
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    status: ok ? 200 : 503,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'X-Robots-Tag': 'noindex',
    },
  });
}
