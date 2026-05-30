import { ImageResponse } from 'next/og';

/**
 * T-108 · Dynamic Open Graph image generator.
 *
 * Edge runtime (requerimiento de `next/og` ImageResponse). Devuelve un PNG
 * 1200x630 con el título recibido por query param + tagline + branding.
 *
 * Uso desde metadata por-página:
 *   openGraph: {
 *     images: [{ url: `/api/og?title=${encodeURIComponent('Precios')}`,
 *                width: 1200, height: 630 }],
 *   }
 *
 * `next/og` admite un subset de CSS (no Tailwind classes, no animations, no
 * pseudo-elements). Todos los estilos son inline. Las fuentes default son
 * sans/serif del runtime — bumpear a Geist/Inter via fetch requiere agregar
 * los archivos `.ttf` al edge bundle (deferred a follow-up si la tipografía
 * default no convence visualmente).
 *
 * NOTA: NO importa `import 'server-only'` indirectamente vía `@/env` u otros
 * — el edge runtime es estricto sobre node:* APIs. Todo lo que necesite acá
 * va inline.
 */

export const runtime = 'edge';

const BRAND_PRIMARY = '#5650f5';
const BRAND_BG = '#0b0b14';
const BRAND_FG = '#fafafa';
const BRAND_MUTED = '#a1a1aa';

const DEFAULT_TITLE = 'IA argentina para higienistas freelance';
const DEFAULT_TAGLINE = 'Informes técnicos en 5 min · Calendario que avisa antes';
const DEFAULT_PRICING = 'ARS 30.000/mes · 14 días sin tarjeta';

/** Trim ruidoso defensivo para evitar render de query gigante (atacante DOS). */
function sanitizeTitle(raw: string | null): string {
  if (!raw) return DEFAULT_TITLE;
  const trimmed = raw.trim().slice(0, 90);
  return trimmed.length > 0 ? trimmed : DEFAULT_TITLE;
}

export function GET(request: Request): ImageResponse {
  const url = new URL(request.url);
  const title = sanitizeTitle(url.searchParams.get('title'));
  const tagline = sanitizeTitle(url.searchParams.get('tagline') ?? DEFAULT_TAGLINE);

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '72px 80px',
        background: `linear-gradient(135deg, ${BRAND_BG} 0%, #1a1a2e 50%, #2a2050 100%)`,
        color: BRAND_FG,
        fontFamily: 'sans-serif',
      }}
    >
      {/* Top row: brand mark */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 12,
            background: BRAND_PRIMARY,
            color: BRAND_FG,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 28,
            fontWeight: 700,
          }}
        >
          CD
        </div>
        <span style={{ fontSize: 28, fontWeight: 600 }}>ConsultoraDemo</span>
      </div>

      {/* Center: title + tagline */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <h1
          style={{
            fontSize: 68,
            fontWeight: 700,
            lineHeight: 1.1,
            margin: 0,
            letterSpacing: '-0.02em',
          }}
        >
          {title}
        </h1>
        <p
          style={{
            fontSize: 30,
            color: BRAND_MUTED,
            margin: 0,
            lineHeight: 1.35,
          }}
        >
          {tagline}
        </p>
      </div>

      {/* Bottom row: pricing badge + URL */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 22px',
            borderRadius: 9999,
            background: BRAND_PRIMARY,
            color: BRAND_FG,
            fontSize: 24,
            fontWeight: 600,
          }}
        >
          {DEFAULT_PRICING}
        </div>
        <span style={{ fontSize: 22, color: BRAND_MUTED }}>consultora-demo.test-ia.cloud</span>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
    },
  );
}
