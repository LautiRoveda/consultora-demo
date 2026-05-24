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

  // T-106 · Modelo Claude usado por el endpoint /api/epp/sugerir-epp. Default
  // Haiku 4.5 (cheap+fast, ideal para clasificación EPP↔riesgos). Override en
  // EasyPanel a 'claude-sonnet-4-6' si el muestreo de feedback dice que la
  // calidad de Haiku no alcanza. Ningún otro módulo del producto consume esta
  // var — el resto sigue usando CLAUDE_MODEL (Sonnet 4.6) hardcoded.
  ANTHROPIC_EPP_SUGGEST_MODEL: z.string().min(1).default('claude-haiku-4-5-20251001'),

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

  // Telegram Bot API token (T-033). Generado por BotFather con `/newbot`.
  // Formato: '<bot_id>:<35-char-hash>'. Server-only — leak = bot hijacking
  // (atacante manda mensajes a todos los usuarios linkeados).
  // Ver docs/operations/telegram-setup.md.
  TELEGRAM_BOT_TOKEN: z.string().min(40),

  // Username del bot SIN el @ inicial. Usado para construir el deep-link
  // `https://t.me/<username>?start=<code>` que el user clickea desde la UI.
  // Constraint: lo permitido por Telegram (a-zA-Z0-9_).
  TELEGRAM_BOT_USERNAME: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-zA-Z0-9_]+$/, 'Solo letras, dígitos y underscores (sin @).'),

  // Shared secret entre Telegram y el endpoint POST
  // /api/webhooks/telegram (T-033). Telegram lo manda como header
  // X-Telegram-Bot-Api-Secret-Token. Generar con `openssl rand -hex 32`.
  // Server-only — leak permite a un atacante invocar el webhook
  // simulando ser Telegram.
  TELEGRAM_WEBHOOK_SECRET: z.string().min(32),

  // Web Push VAPID keys (T-034). Generar UNA VEZ con
  // `npx web-push generate-vapid-keys`. NUNCA regenerar productivo: invalida
  // todas las subscriptions existentes (el Push Service asocia la public key
  // al endpoint al momento del subscribe).
  //
  // Private key: base64url ~44 chars. Server-only — leak = atacante puede
  // enviar push spam a todos los users subscritos.
  VAPID_PRIVATE_KEY: z.string().min(40),

  // Public key: base64url ~88 chars. Inlinada al bundle del cliente (prefix
  // NEXT_PUBLIC_) porque el browser la necesita en pushManager.subscribe()
  // como applicationServerKey. No es secret — su exposición es by-design.
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().min(80),

  // Subject identificando al sender al Push Service. Spec web-push exige
  // `mailto:` o `https://` (los Push Services rechazan otros formatos).
  // Default sensato: mail no-reply del subdominio Resend (mismo patrón
  // RESEND_REPLY_TO_ADDRESS T-031). Override en EasyPanel si Lautaro quiere
  // un mailto: contacto distinto sin redeploy.
  VAPID_SUBJECT: z
    .string()
    .regex(
      /^(mailto:|https:\/\/)/,
      'Debe empezar con mailto: o https:// (requerido por web-push spec).',
    )
    .default('mailto:noreply@mail.consultora-demo.test-ia.cloud'),

  // Precio del plan Pro en centavos ARS (T-070). String regex para evitar
  // sorpresas de decimales/float. Ejemplo "3000000" = ARS 30.000 = USD 30 al
  // FX al momento de cargar. Lautaro lo ajusta manualmente en EasyPanel cuando
  // hay drift FX (USD oficial vs blue, no hay BCRA lookup automático en MVP —
  // futuro T-070-FU1 si emerge necesidad). Server-only — usado por T-071 al
  // crear preapproval en Mercado Pago Subscriptions API.
  ARS_PRICE_MONTHLY: z.string().regex(/^\d+$/, 'centavos ARS sin decimales (ej "3000000").'),

  // Mercado Pago Subscriptions API (T-071). Server-only — leak = atacante
  // crea/cancela preapprovals en nombre de la consultora.
  //
  // MP_ACCESS_TOKEN: bearer token del marketplace de MP. En dev prefijo
  // 'TEST-' (sandbox). En prod prefijo 'APP_USR-'. Generar en
  // https://www.mercadopago.com.ar/developers/panel/app.
  MP_ACCESS_TOKEN: z.string().min(40),

  // MP_WEBHOOK_SECRET: shared secret para HMAC SHA256 del header
  // x-signature en POST /api/webhooks/mercadopago. Configurar en MP
  // panel → Webhooks → "Clave secreta". Generar con `openssl rand -hex 32`.
  MP_WEBHOOK_SECRET: z.string().min(32),

  // T-071-FU2 · Solo dev/test. Si está set, createSubscriptionAction lo usa
  // como payer_email del preapproval en vez del email real del owner. MP
  // sandbox bloquea auto-purchase (seller email == buyer email) — esta var
  // permite inyectar el email del TEST USER buyer creado en MP panel.
  // NUNCA setear en prod (warn explicito post-parse).
  //
  // preprocess: trata "" como undefined (EasyPanel / shell a veces dejan
  // env vars como string vacío en vez de unset; sin esto, Zod email()
  // rechazaria "" y el boot rompe).
  MP_TEST_PAYER_EMAIL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().email().optional(),
  ),

  // Upstash Redis para rate limiting (T-081). Optional: si NO presentes, el
  // helper getRateLimiter devuelve un noop stub que siempre allows — útil para
  // dev local sin cuenta Upstash. EN PRODUCCIÓN ambas DEBEN estar seteadas en
  // EasyPanel (ver docs/operations/rate-limiting.md). Sin estas vars en prod,
  // los rate limits NO aplican y los endpoints quedan expuestos a abuse.
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),

  // Bypass del trial gate (T-073). Server-only. z.enum: un typo ('ture', '1',
  // 'TRUE') rompe al boot en lugar de quedar como 'false' silenciosamente.
  // SIEMPRE 'false' en producción — un 'true' en prod = app sin gate.
  // 'true' en .env.local permite a Lautaro testear features con trial vencido
  // sin tener que crear una suscripción MP real.
  BILLING_GATE_DISABLED: z.enum(['true', 'false']).default('false'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Variables de entorno inválidas:');
  console.error(parsed.error.issues);
  throw new Error('Invalid environment variables — ver logs arriba.');
}

// T-073 · Warn explícito si el bypass del gate queda activo en producción.
// console.warn (no logger pino) porque al boot del módulo env, el logger aún
// no está disponible. Sale en stdout del container → visible en EasyPanel
// logs y en Sentry breadcrumbs.
if (parsed.data.BILLING_GATE_DISABLED === 'true' && process.env.NODE_ENV === 'production') {
  console.warn(
    '⚠️  BILLING_GATE_DISABLED=true en NODE_ENV=production — el trial gate está DESHABILITADO. Setear a "false" en EasyPanel.',
  );
}

// T-071-FU2 · Warn si MP_TEST_PAYER_EMAIL queda set en producción. El payer
// del preapproval NO va a ser el owner real — los cobros llegan a un test
// buyer y no al user productivo.
if (parsed.data.MP_TEST_PAYER_EMAIL && process.env.NODE_ENV === 'production') {
  console.warn(
    '⚠️  MP_TEST_PAYER_EMAIL está set en NODE_ENV=production — el payer del preapproval NO es el owner real. Unset en EasyPanel.',
  );
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
