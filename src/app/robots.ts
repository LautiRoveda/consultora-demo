import type { MetadataRoute } from 'next';

import { env } from '@/env';

/**
 * `/robots.txt` — generado por Next.js Metadata API en build.
 *
 * Permite indexación de la landing pública. Excluye:
 * - `/api/*` (endpoints internos, no son páginas).
 * - `/styleguide` (dev tool, gated por NODE_ENV pero la URL existe).
 * - `/login` (`metadata.robots.index = false` en page.tsx ya lo cubre, pero
 *   lo duplicamos acá como defensa en profundidad).
 *
 * `/terminos` y `/privacidad` están en versión preliminar — sus pages
 * declaran `robots: { index: false, follow: false }` en metadata para
 * evitar indexación hasta revisión legal pre-launch comercial.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/styleguide', '/login'],
      },
    ],
    sitemap: `${env.NEXT_PUBLIC_SITE_URL}/sitemap.xml`,
    host: env.NEXT_PUBLIC_SITE_URL,
  };
}
