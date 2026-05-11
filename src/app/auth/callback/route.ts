import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

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
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const next = sanitizeNext(searchParams.get('next'));

  if (!code && !tokenHash) {
    logger.warn({ url: request.url }, 'auth/callback invocado sin code ni token_hash');
    return NextResponse.redirect(`${origin}/login?error=callback_failed`);
  }

  const supabase = await createClient();

  if (code) {
    // PKCE flow: exchange the authorization code for a session.
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      logger.error({ error, code: code.slice(0, 8) }, 'exchangeCodeForSession falló');
      return NextResponse.redirect(`${origin}/login?error=callback_failed`);
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
      return NextResponse.redirect(`${origin}/login?error=callback_failed`);
    }
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) {
      logger.error({ error, type, tokenHash: tokenHash.slice(0, 8) }, 'verifyOtp falló');
      return NextResponse.redirect(`${origin}/login?error=callback_failed`);
    }
  }

  // Routing post-exchange:
  // - magic link → /dashboard (usuario ya logueado).
  // - password recovery → /cambiar-password (sesión recovery activa).
  // - signup confirm → /login?confirmed=1 (usuario debe ingresar manualmente).
  // - backward compat (sin next) → /login?confirmed=1.
  if (next === '/dashboard') {
    return NextResponse.redirect(`${origin}/dashboard`);
  }
  if (next === '/cambiar-password') {
    return NextResponse.redirect(`${origin}/cambiar-password`);
  }
  return NextResponse.redirect(`${origin}/login?confirmed=1`);
}
