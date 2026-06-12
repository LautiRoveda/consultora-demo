import type { NextRequest } from 'next/server';
import { after, NextResponse } from 'next/server';

import { env } from '@/env';
import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { TRIAL_DAYS } from '@/shared/lib/trial-days';
import { renderWelcomeEmail } from '@/shared/notifications/email-templates/welcome';
import { sendEmail } from '@/shared/notifications/senders/email';
import { logger } from '@/shared/observability/logger';
import { createClient } from '@/shared/supabase/server';

/**
 * Callback handler para email confirmation (T-012 signup), magic link (T-013)
 * y password recovery (T-014).
 *
 * Supabase puede redirigir acá con uno de dos shapes (depende del template de
 * email y la versión del SDK):
 *
 * 1. **PKCE flow (preferido):** `?code=<jwt-like>` → `exchangeCodeForSession`.
 *    Lo usan templates modernos con `{{ .ConfirmationURL }}` apuntando directo
 *    a nuestro callback.
 * 2. **token_hash flow:** `?token_hash=<hex>&type=<otpType>` → `verifyOtp`.
 *    Lo emite `admin.generateLink` (dev tool T-014) y algunos templates legacy.
 *    Cubierto explícitamente acá para que el dev tool `pnpm dev:recovery-link`
 *    pueda validar el redirect chain end-to-end sin esperar email real.
 *
 * `?next=<path>` se sanitiza contra una allowlist estricta para prevenir
 * open-redirect attacks. Cualquier valor desconocido cae al default
 * `/login?confirmed=1` (también el caso de emails sin `next` —
 * backward-compat).
 *
 * Este route handler vive fuera del route group `(auth)` para que la URL
 * pública sea literal `/auth/callback`, que es la que configuramos en
 * Supabase dashboard → Authentication → URL Configuration → Redirect URLs.
 *
 * Routing post-exchange según `?next=`:
 * - signup confirm (T-012):     `?next=/login&from=signup`
 * - magic link login (T-013):   `?next=/dashboard&from=magic_link`
 * - password recovery (T-014):  `?next=/cambiar-password&from=recovery`
 */
const NEXT_ALLOWLIST = ['/dashboard', '/login', '/cambiar-password'] as const;

const VALID_OTP_TYPES = ['recovery', 'magiclink', 'signup', 'email_change'] as const;
type ValidOtpType = (typeof VALID_OTP_TYPES)[number];

function sanitizeNext(raw: string | null): string | null {
  if (!raw) return null;
  // Defensa anti open-redirect: paths internos, sin `//` ni protocol.
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  // Allowlist estricta.
  return (NEXT_ALLOWLIST as readonly string[]).includes(raw) ? raw : null;
}

function isValidOtpType(t: string | null): t is ValidOtpType {
  return t !== null && (VALID_OTP_TYPES as readonly string[]).includes(t);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const next = sanitizeNext(searchParams.get('next'));
  const from = searchParams.get('from');

  // T-022.5-FU4: usar NEXT_PUBLIC_SITE_URL como base del redirect evita que
  // tome el bind interno del container (0.0.0.0:80) cuando está detrás de
  // Traefik en EasyPanel. `new URL(request.url).origin` parseaba el bind
  // upstream porque Next no confía en X-Forwarded-Host por default, mandando
  // al browser a un host inválido. Strip de trailing slash defensivo.
  const siteUrl = env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');

  if (!code && !tokenHash) {
    logger.warn({ url: request.url }, 'auth/callback invocado sin code ni token_hash');
    return NextResponse.redirect(`${siteUrl}/login?error=callback_failed`);
  }

  const supabase = await createClient();

  if (code) {
    // PKCE flow: exchange the authorization code for a session.
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      logger.error({ error, code: code.slice(0, 8) }, 'exchangeCodeForSession falló');
      return NextResponse.redirect(`${siteUrl}/login?error=callback_failed`);
    }
    // T-016 PARADA #3: refresh post-signup-confirm garantiza que el JWT
    // emitido tras el exchange traiga el claim consultora_id. Race posible:
    // si el RPC create_consultora_and_owner (T-012) corrio recien, el primer
    // JWT del exchange puede haberse firmado antes que el hook viera la
    // membership. Refresh fuerza re-issue post-membership. Fallback T-013
    // cubre si refresh falla — no bounceamos, solo log para observability.
    const { error: refreshErr } = await supabase.auth.refreshSession();
    if (refreshErr) {
      logger.warn({ refreshErr }, 'refresh_session_post_callback_failed');
    }
  } else if (tokenHash) {
    // token_hash flow: verify the OTP token. Requires a valid `type` from the
    // allowlist (otherwise possible attack vector + Supabase tira con `email`
    // type que no usamos en ningún flow nuestro).
    if (!isValidOtpType(type)) {
      logger.warn(
        { url: request.url, type },
        'auth/callback token_hash con type ausente o inválido',
      );
      return NextResponse.redirect(`${siteUrl}/login?error=callback_failed`);
    }
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) {
      logger.error({ error, type, tokenHash: tokenHash.slice(0, 8) }, 'verifyOtp falló');
      return NextResponse.redirect(`${siteUrl}/login?error=callback_failed`);
    }
  }

  // T-142 · Welcome email post-confirmación. Solo en el flow de signup
  // (`from=signup`), donde el exchange/verify de arriba ya confirmó al usuario y
  // existe sesión. `after()` difiere el envío hasta después de mandar la
  // respuesta de redirect: no demora el bounce a /login y, en el server
  // long-running del VPS, garantiza ejecución (un floating promise pelado tras
  // `return` no está garantizado). Fire-and-forget: un error de Resend no afecta
  // el flujo. Idempotente: el token de confirmación es single-use, así que un
  // segundo click falla el exchange y corta antes de este bloque.
  if (from === 'signup') {
    after(async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user?.email) return;
        const consultora = await getCurrentConsultora(supabase, user.id);
        const { subject, html, text } = renderWelcomeEmail({
          consultoraName: consultora?.name ?? 'tu consultora',
          trialDays: TRIAL_DAYS,
          informesUrl: `${siteUrl}/informes/nuevo`,
          eppUrl: `${siteUrl}/epp/entregas/nueva`,
        });
        const result = await sendEmail({ to: user.email, subject, html, text });
        if (!result.ok) {
          logger.error({ reason: result.reason, userId: user.id }, 'welcome_email_failed');
        }
      } catch (err) {
        logger.error({ err }, 'welcome_email_failed');
      }
    });
  }

  // Routing post-exchange:
  // - magic link → /dashboard (usuario ya logueado).
  // - password recovery → /cambiar-password (sesión recovery activa).
  // - signup confirm → /login?confirmed=1 (usuario debe ingresar manualmente).
  // - backward compat (sin next) → /login?confirmed=1.
  if (next === '/dashboard') {
    return NextResponse.redirect(`${siteUrl}/dashboard`);
  }
  if (next === '/cambiar-password') {
    return NextResponse.redirect(`${siteUrl}/cambiar-password`);
  }
  return NextResponse.redirect(`${siteUrl}/login?confirmed=1`);
}
