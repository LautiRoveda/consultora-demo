import 'server-only';

import { z } from 'zod';

/**
 * Schema de variables de entorno del proyecto.
 *
 * Exportado aparte del valor parseado para permitir tests aislados que
 * invocan `envSchema.safeParse(...)` con inputs ad-hoc.
 */
export const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Sentry (T-007). El DSN público no es secreto — lo expone el bundle del
  // cliente. SENTRY_ORG y SENTRY_PROJECT son server-only (los usa
  // withSentryConfig para upload de source maps).
  NEXT_PUBLIC_SENTRY_DSN: z.string().url(),
  SENTRY_ORG: z.string().min(1),
  SENTRY_PROJECT: z.string().min(1),
  // Override opcional: setear a 'true' en .env.local para forzar envío real a
  // Sentry desde NODE_ENV=development (validación end-to-end de /api/test-error).
  // Vacío en uso normal.
  SENTRY_FORCE_ENABLE: z.string().optional(),

  // URL pública del sitio (T-009). Usada por src/app/robots.ts y
  // src/app/sitemap.ts para generar URLs absolutas. En T-010 se setea como
  // env var en Vercel con el dominio real; mientras tanto, default placeholder.
  NEXT_PUBLIC_SITE_URL: z.string().url().default('https://consultorademo.com.ar'),

  // Anthropic Claude API (T-020). Server-only — NUNCA prefix NEXT_PUBLIC.
  // Leak = facturación ajena. El bundler de Next falla si `env.ts` se importa
  // client-side gracias al `server-only` del tope.
  ANTHROPIC_API_KEY: z.string().min(1),

  // Resend API (T-031). Server-only — leak = spam ajeno + cuenta suspendida.
  RESEND_API_KEY: z.string().min(1),

  // Email FROM address (T-031). Debe estar verificado en Resend con DNS
  // (SPF + DKIM) del subdominio correspondiente. Ver
  // docs/operations/resend-setup.md.
  RESEND_FROM_ADDRESS: z.string().email(),

  // Email Reply-To (T-031). Opcional con default sensato. Lautaro puede
  // override en EasyPanel env vars si quiere un reply-to especifico
  // (ej. soporte@…) sin redeploy de codigo.
  RESEND_REPLY_TO_ADDRESS: z.string().email().default('noreply@mail.consultora-demo.test-ia.cloud'),

  // Shared secret entre pg_cron y el endpoint POST
  // /api/calendar/dispatch-reminder (T-031). Mismo valor que el secret
  // de Vault `cron_dispatch_secret`. Generar con `openssl rand -hex 32`.
  // Server-only — leak permite a cualquiera disparar notificaciones
  // arbitrarias contra el endpoint.
  INTERNAL_CRON_SECRET: z.string().min(32),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Variables de entorno inválidas:');
  console.error(parsed.error.issues);
  throw new Error('Invalid environment variables — ver logs arriba.');
}

/**
 * Variables de entorno validadas y tipadas.
 *
 * **Server-only.** Este módulo importa `server-only` al tope: si un Client
 * Component (`'use client'`) lo importa por error, el build de Next.js falla
 * con un mensaje explícito.
 *
 * En Client Components leer `process.env.NEXT_PUBLIC_*` directo — Next.js los
 * inlinea en el bundle del cliente en build time, así que la "validación" se
 * resuelve en build (un valor faltante deja el bundle con `undefined` y rompe
 * en runtime al primer uso).
 */
export const env = parsed.data;

export type Env = z.infer<typeof envSchema>;
