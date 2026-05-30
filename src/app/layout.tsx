import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';

import { env } from '@/env';
import { Toaster } from '@/shared/ui/sonner';

import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const SITE_NAME = 'ConsultoraDemo';
const SITE_DESCRIPTION =
  'IA argentina que escribe tus informes técnicos con citas SRT verificadas y avisa antes de cada vencimiento normativo. Para higienistas freelance — plan único ARS 30.000/mes, 14 días gratis sin tarjeta.';

/**
 * Indexación global (T-010 + T-108 CP4): solo el deploy productivo real
 * permite indexar.
 *
 * Post-CHORE-D + ADR-0007 migramos de Vercel a VPS Hostinger + EasyPanel.
 * El guard original chequeaba `VERCEL_ENV === 'production'` — obsoleto:
 * en EasyPanel `VERCEL_ENV` siempre está undefined → la página productiva
 * nunca era indexable. T-108 CP2 reportó SEO 66 en Lighthouse local por
 * este motivo.
 *
 * Guard nuevo: `NODE_ENV === 'production'` AND `NEXT_PUBLIC_SITE_URL`
 * matchea el dominio productivo real. Builds locales (NODE_ENV !==
 * production o NEXT_PUBLIC_SITE_URL apuntando a localhost/placeholder)
 * quedan noindex por defecto.
 *
 * TODO: si en el futuro hay staging.consultora-demo.test-ia.cloud o
 * similar, actualizar el chequeo de NEXT_PUBLIC_SITE_URL para excluirlos
 * del index (lista explícita de dominios indexables).
 */
const IS_PRODUCTION_DEPLOY =
  process.env.NODE_ENV === 'production' &&
  env.NEXT_PUBLIC_SITE_URL === 'https://consultora-demo.test-ia.cloud';

export const metadata: Metadata = {
  metadataBase: new URL(env.NEXT_PUBLIC_SITE_URL),
  title: {
    default: `${SITE_NAME} · Informes HyS con IA + calendario de vencimientos`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: [
    'higiene y seguridad laboral',
    'HyS',
    'consultor HyS',
    'higienista freelance',
    'informes técnicos',
    'SRT',
    'Res SRT 85/12',
    'Res SRT 299/11',
    'EPP',
    'calendario vencimientos normativos',
    'IA Argentina',
    'Argentina',
  ],
  authors: [{ name: SITE_NAME }],
  openGraph: {
    type: 'website',
    locale: 'es_AR',
    url: env.NEXT_PUBLIC_SITE_URL,
    siteName: SITE_NAME,
    title: `${SITE_NAME} · Informes HyS con IA + calendario de vencimientos`,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} · Informes HyS con IA + calendario de vencimientos`,
    description: SITE_DESCRIPTION,
  },
  robots: IS_PRODUCTION_DEPLOY ? undefined : { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es-AR" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
