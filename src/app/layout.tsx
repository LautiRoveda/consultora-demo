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
  'El asistente argentino que escribe tus informes con IA y nunca te deja olvidar un vencimiento. Para consultores HyS por USD 30 al mes.';

export const metadata: Metadata = {
  metadataBase: new URL(env.NEXT_PUBLIC_SITE_URL),
  title: {
    default: `${SITE_NAME} · Generador de informes HyS con IA`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: [
    'higiene y seguridad laboral',
    'HyS',
    'consultor HyS',
    'informes técnicos',
    'SRT',
    'Resolución 299/11',
    'EPP',
    'Argentina',
  ],
  authors: [{ name: SITE_NAME }],
  openGraph: {
    type: 'website',
    locale: 'es_AR',
    url: env.NEXT_PUBLIC_SITE_URL,
    siteName: SITE_NAME,
    title: `${SITE_NAME} · Generador de informes HyS con IA`,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} · Generador de informes HyS con IA`,
    description: SITE_DESCRIPTION,
  },
  /*
   * Indexación global (T-010): solo el deploy de production permite indexar.
   * Preview deploys de Vercel emiten `<meta name="robots" content="noindex,nofollow">`
   * a nivel root layout para evitar que Google indexe URLs efímeras tipo
   * `consultora-demo-git-<branch>-<scope>.vercel.app`.
   *
   * `VERCEL_ENV` lo inyecta Vercel automáticamente: 'production' | 'preview' |
   * 'development'. En build local sin Vercel queda undefined → la rama
   * `!== 'production'` aplica noindex (seguro por default).
   */
  robots: process.env.VERCEL_ENV === 'production' ? undefined : { index: false, follow: false },
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
