import 'server-only';

import { logger } from '@/shared/observability/logger';

/**
 * T-023-FU4 · Inyecta `<base href={baseUrl}/>` como primer hijo del `<head>`.
 *
 * Puppeteer `page.setContent(html)` renderea el HTML en `about:blank` sin
 * baseURL. Las URLs relativas que Next.js emite en el `<link rel="stylesheet">`
 * de los chunks de Tailwind (`/_next/static/chunks/...`) intentan resolver
 * contra `about:blank` y fallan silenciosamente — la stylesheet nunca carga
 * y las clases Tailwind no aplican (grid, badges, spacing, etc.).
 *
 * Solución: antes de pasar el HTML server-rendered a `htmlToPdf()`, prepend
 * un `<base href>` apuntando al dev server interno. El browser usa ese href
 * para resolver TODA URL relativa del documento (CSS, scripts, imágenes).
 *
 * Edge case: si por alguna razón el HTML viene sin `<head>` (cambio de
 * estructura en Next.js, error de render upstream), retornamos sin cambios
 * + log warning. Mejor PDF con clases default que romper la generación entera.
 */
export function injectBaseHref(html: string, baseUrl: string): string {
  const normalized = baseUrl.replace(/\/$/, '');
  if (!/<head[^>]*>/i.test(html)) {
    logger.warn({ baseUrl }, 'inject_base_href: html sin <head>, sin cambios');
    return html;
  }
  return html.replace(/<head[^>]*>/i, (match) => `${match}<base href="${normalized}/"/>`);
}
