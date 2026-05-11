import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/shared/supabase/server';

import { UpdatePasswordForm } from './UpdatePasswordForm';

export const metadata: Metadata = {
  title: 'Cambiar contraseña · ConsultoraDemo',
  description: 'Definí una nueva contraseña para tu cuenta.',
  robots: { index: false, follow: false },
};

/**
 * Página protegida server-side. Cualquier sesión activa (recovery o normal)
 * permite cambiar la contraseña — sin sesión → redirect a /login.
 *
 * El user llega acá:
 * - Vía `/auth/callback?next=/cambiar-password&from=recovery` (flow T-014).
 * - Eventualmente (T-017+) desde un Settings page con sesión normal.
 */
export default async function UpdatePasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

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
        <UpdatePasswordForm />
      </main>
    </div>
  );
}
