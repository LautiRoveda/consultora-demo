import type { NextConfig } from 'next';
import path from 'node:path';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  async rewrites() {
    return [
      { source: '/prototipo', destination: '/prototipo/index.html' },
      { source: '/prototipo/', destination: '/prototipo/index.html' },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Slugs del proyecto Sentry. En dev/CI sin `SENTRY_AUTH_TOKEN`, el plugin
  // no sube source maps (espera silenciosamente). En T-010 vamos a agregar
  // el secret real en Vercel para que los maps suban en cada deploy.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Suprime el log del wizard durante CI (`pnpm build`). Local sigue verbose
  // para ayudar a debuggear si algo no anda.
  silent: !process.env.CI,

  // Tunnel: el SDK browser manda eventos a `/monitoring` (mismo dominio) y
  // Next.js los reenvía a Sentry. Bypass de adblockers que bloquean el host
  // público de Sentry. `src/proxy.ts` excluye `/monitoring` del matcher.
  tunnelRoute: '/monitoring',

  // Sube source maps de TODOS los archivos del cliente, no solo los de páginas.
  // Sin SENTRY_AUTH_TOKEN (que llega en T-010 con Vercel) el upload se omite
  // silenciosamente — el flag deja el plumbing listo para entonces.
  widenClientFileUpload: true,

  // `disableLogger` y `automaticVercelMonitors` son flags de la API legacy
  // (webpack). En Next.js 16 con Turbopack son no-op y emiten deprecation
  // warning durante el build. Los omitimos: el equivalente turbopack vive
  // bajo `webpack.*` que no aplica a nuestro pipeline. El SDK ya hace tree-
  // shaking del logger por default cuando no hay debug habilitado.
});
