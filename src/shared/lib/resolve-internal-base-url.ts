import 'server-only';

import { type NextRequest } from 'next/server';

/**
 * T-023-FU2 · Resuelve la URL base para fetches internos del proceso a si
 * mismo (e.g. el route handler PDF hacia la vista print de su informe).
 *
 * Prioridad:
 *  1. `INTERNAL_BASE_URL` env truthy → override explicito (testing/staging/
 *     edge case). Trim trailing slash para evitar `//path`.
 *  2. `NODE_ENV === 'production'` → `http://127.0.0.1:${PORT}`. Loopback IPv4
 *     evita round trip por DNS externo + Cloudflare/Traefik. En VPS+EasyPanel
 *     `request.url` devuelve el dominio publico porque Traefik termina TLS,
 *     asi que un fetch contra request.url sale por internet, vuelve por
 *     proxies, y entra al mismo container — 50-200ms extra + dependencia
 *     del proxy. 127.0.0.1 (no `localhost`) bypasea cualquier resolver DNS
 *     lento o roto adentro del container alpine.
 *  3. dev/test → `new URL(request.url).origin`. En `pnpm dev` el origin es
 *     http://localhost:3000, exactamente lo que queremos. Vitest mockea
 *     fetch — no llega en practica.
 *  4. catch del URL parse → throw fail-fast. Solo dispara si NODE_ENV no es
 *     'production' y request.url es invalido — indica un bug del caller o
 *     un test mal armado, no un edge real en runtime.
 */
export function resolveInternalBaseUrl(request: NextRequest): string {
  const explicit = process.env.INTERNAL_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, '');

  const port = process.env.PORT ?? '3000';

  if (process.env.NODE_ENV === 'production') {
    return `http://127.0.0.1:${port}`;
  }

  try {
    return new URL(request.url).origin;
  } catch {
    throw new Error(
      `resolveInternalBaseUrl: no se pudo resolver base URL. ` +
        `NODE_ENV=${process.env.NODE_ENV ?? '(undefined)'}, ` +
        `request.url=${request.url}. ` +
        `Seteá INTERNAL_BASE_URL para overridear.`,
    );
  }
}
