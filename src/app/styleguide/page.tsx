import { notFound } from 'next/navigation';

import { StyleguideClient } from './StyleguideClient';

/**
 * Página de referencia visual del theme y los componentes shadcn instalados.
 *
 * **Dev tool gated por NODE_ENV.** En producción devuelve 404 — la página queda
 * accesible solo en `pnpm dev` y en preview deploys que no tengan
 * `NODE_ENV=production`. Mismo patrón que `/api/test-error` (T-007).
 *
 * `dynamic = 'force-dynamic'` evita que `pnpm build` la prerendere — el check
 * de `NODE_ENV` corre en runtime, no en build time.
 */
export const dynamic = 'force-dynamic';

export default function StyleguidePage() {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  return <StyleguideClient />;
}
