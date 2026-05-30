import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { LoginForm } from './LoginForm';

export const metadata: Metadata = {
  title: 'Iniciar sesión',
  description: 'Accedé a tu cuenta de ConsultoraDemo.',
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <div className="w-full max-w-sm space-y-4">
      {/* Suspense boundary requerido por LoginForm que usa useSearchParams para
          leer ?confirmed=1 y ?error=callback_failed. Sin él, el prerender estático
          de /login rompe en Next.js 16. */}
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
      <p className="text-muted-foreground text-center text-sm">
        <Link href="/" className="hover:text-foreground">
          ← Volver a la home
        </Link>
      </p>
    </div>
  );
}
