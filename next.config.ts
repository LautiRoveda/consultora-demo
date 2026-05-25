import type { NextConfig } from 'next';
import path from 'node:path';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  // Self-host VPS Hostinger (T-022.5, ADR-0007). Genera .next/standalone con
  // server.js + node_modules necesarios para correr Node 22 alpine. Imagen
  // Docker resultante ~150 MB vs ~1.2 GB sin standalone.
  output: 'standalone',
  // T-023: puppeteer-core usa child_process + net + WebSocket nativos del
  // protocolo DevTools. Bundlearlo con webpack/turbopack rompe estos
  // bindings — debe quedarse externo y resolverse a runtime via node_modules.
  serverExternalPackages: ['puppeteer-core'],
  turbopack: {
    root: path.resolve(__dirname),
  },
  async rewrites() {
    return [
      { source: '/prototipo', destination: '/prototipo/index.html' },
      { source: '/prototipo/', destination: '/prototipo/index.html' },
    ];
  },
  // CHORE-D · I2 · Security headers globales.
  //
  // CSP ajustada al stack real del MVP — NO incluye los típicos "por las dudas"
  // que aún no usamos (cdn.mercadopago.com, *.sentry.io, api.mercadopago.com,
  // mercadopago.com.ar como frame). Si se agrega MP Brick o se desactiva el
  // tunnel /monitoring de Sentry, relaxear puntualmente con comment justificando.
  //
  //  - script-src 'self' + 'unsafe-inline' (Next.js RSC payload + hydration scripts
  //    inline; migración a nonce-based queda para una iter futura).
  //  - style-src 'self' + 'unsafe-inline' (Tailwind 4 + shadcn).
  //  - img-src: data: (avatars/SVG), blob: (canvas/PDF preview), *.supabase.co
  //    (signed URLs Storage — logos, attachments de informes).
  //  - connect-src: *.supabase.co REST + wss://*.supabase.co defensivo por si se
  //    agrega realtime (no se usa hoy). MP API es server-side, no entra acá.
  //  - frame-src 'none' + X-Frame-Options DENY: doble defensa anti-clickjacking.
  //  - frame-ancestors 'none': bloquea que NOS embeban en otros sitios.
  //
  // El route group (print) en src/app/(print)/layout.tsx mete su propio <meta>
  // CSP más estricto (script-src 'none', connect-src 'none'). Browser aplica
  // intersección — ambos conviven sin conflicto.
  async headers() {
    // React DEV mode usa eval() para debugging features (reconstrucción de
    // stacktraces, fast refresh). En prod NUNCA usa eval — agregamos
    // 'unsafe-eval' SOLO en development. Smoke validado: sin esto en dev, los
    // chunks turbopack tiran ~25 CSP violations por página + "eval is not
    // supported" error en hydration → app deja de hidratar interactividad.
    const isDev = process.env.NODE_ENV === 'development';
    const scriptSrc = isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'";

    const csp = [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.supabase.co",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ');

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
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
