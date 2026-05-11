import type { Metadata } from 'next';
import Link from 'next/link';

import { RecoverPasswordForm } from './RecoverPasswordForm';

export const metadata: Metadata = {
  title: 'Recuperar contraseña · ConsultoraDemo',
  description: 'Recuperá tu acceso a ConsultoraDemo enviándote un link al email.',
  robots: { index: false, follow: false },
};

export default function RecoverPasswordPage() {
  return (
    <div className="bg-muted/30 flex min-h-screen flex-col">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-md text-sm font-bold">
              CD
            </span>
            <span className="text-sm font-semibold">ConsultoraDemo</span>
          </Link>
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm space-y-4">
          <RecoverPasswordForm />
          <p className="text-muted-foreground text-center text-sm">
            <Link href="/" className="hover:text-foreground">
              ← Volver a la home
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
