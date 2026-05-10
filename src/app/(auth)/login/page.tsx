import type { Metadata } from 'next';
import Link from 'next/link';

import { LoginForm } from './LoginForm';

export const metadata: Metadata = {
  title: 'Iniciar sesión · ConsultoraDemo',
  description: 'Accedé a tu cuenta de ConsultoraDemo.',
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <div className="w-full max-w-sm space-y-4">
      <LoginForm />
      <p className="text-muted-foreground text-center text-sm">
        <Link href="/" className="hover:text-foreground">
          ← Volver a la home
        </Link>
      </p>
    </div>
  );
}
