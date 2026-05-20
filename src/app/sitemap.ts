import type { MetadataRoute } from 'next';

import { env } from '@/env';

/**
 * `/sitemap.xml` — generado por Next.js Metadata API en build.
 *
 * Lista las URLs públicas indexables del sitio. Coordinado con `robots.ts`
 * y los `metadata.robots` de cada page para que motores de búsqueda solo
 * accedan a contenido aprobado.
 *
 * Incluido:
 * - `/` — landing pública.
 *
 * Excluido (presente en el sitio pero no apto para indexación):
 * - `/login` (page tiene `robots.index = false`).
 * - `/terminos`, `/privacidad` (versión preliminar pre-revisión legal).
 * - `/styleguide`, `/api/test-error` (dev tools gated por NODE_ENV).
 * - `/prototipo` (demo Fase 0 obsoleta — sigue accesible por URL directa via
 *   rewrite en `next.config.ts`, pero no se indexa para evitar tráfico a la
 *   versión vieja del producto).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = env.NEXT_PUBLIC_SITE_URL;
  const lastModified = new Date('2026-05-10');

  return [
    {
      url: `${base}/`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 1,
    },
  ];
}
