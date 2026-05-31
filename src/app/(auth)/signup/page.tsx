import type { Metadata } from 'next';
import Link from 'next/link';

import { TRIAL_DAYS } from '@/shared/lib/trial-days';

import { SignupForm } from './SignupForm';

export const metadata: Metadata = {
  title: 'Crear cuenta',
  description: `Empezá tu prueba de ${TRIAL_DAYS} días gratis en ConsultoraDemo.`,
  robots: { index: false, follow: false },
};

export default function SignupPage() {
  return (
    <div className="w-full max-w-sm space-y-4">
      <SignupForm />
      <p className="text-muted-foreground text-center text-sm">
        <Link href="/" className="hover:text-foreground">
          ← Volver a la home
        </Link>
      </p>
    </div>
  );
}
