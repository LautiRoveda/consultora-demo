/**
 * T-081 · Helpers para extraer identidad del request.
 *
 * NO `import 'server-only'` para que los tests unit puros lo importen sin
 * trabajar de mock. El módulo NO toca env vars ni Supabase — son helpers
 * puros sobre headers/strings.
 */

/**
 * Extrae IP del request. Cloudflare/EasyPanel pasan IP real en
 * `x-forwarded-for` (primer valor de la lista CSV).
 *
 * NO usar `request.ip` — depende del runtime (edge vs node) y EasyPanel no
 * lo populates de forma confiable. `x-forwarded-for` es industry standard.
 *
 * Fallback `'unknown'` si el header está vacío: todos los requests sin IP
 * comparten la misma bucket de rate limit (defensivo — peor caso, abuse de
 * un IP unknown bloquea otros unknown, pero no hay leak de protección).
 */
export function getClientIp(request: Request): string {
  return extractIpFromForwardedFor(request.headers.get('x-forwarded-for'));
}

/**
 * Variante para Server Actions que usan `headers()` de `next/headers` en lugar
 * de recibir el `Request` directo.
 *
 * Acepta el tipo de retorno de `await headers()` sin importarlo (evita coupling
 * a la versión exacta del shape de Next 16 — el método `.get()` está estable).
 */
export function getClientIpFromHeaders(headers: { get(name: string): string | null }): string {
  return extractIpFromForwardedFor(headers.get('x-forwarded-for'));
}

function extractIpFromForwardedFor(fwd: string | null): string {
  if (!fwd) return 'unknown';
  const first = fwd.split(',')[0]?.trim();
  if (!first) return 'unknown';
  return first;
}

/**
 * Normaliza email para usar como rate limit key.
 *
 * lowercase + trim — matchea cómo Supabase Auth almacena los emails
 * internamente. Sin esta normalización, `User@X.com` y `user@x.com` serían
 * 2 buckets distintos → permite a un atacante evadir el rate limit por email
 * cambiando capitalization.
 */
export function normalizeEmailKey(email: string): string {
  return email.toLowerCase().trim();
}
