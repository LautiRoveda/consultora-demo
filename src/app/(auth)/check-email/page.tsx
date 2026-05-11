import type { Metadata } from 'next';
import { MailIcon } from 'lucide-react';
import Link from 'next/link';

import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

export const metadata: Metadata = {
  title: 'Revisá tu email · ConsultoraDemo',
  description: 'Te enviamos un link para confirmar tu cuenta.',
  robots: { index: false, follow: false },
};

interface CheckEmailPageProps {
  searchParams: Promise<{ email?: string }>;
}

export default async function CheckEmailPage({ searchParams }: CheckEmailPageProps) {
  const { email } = await searchParams;

  return (
    <div className="w-full max-w-sm space-y-4">
      <Card>
        <CardHeader>
          <div className="bg-primary/10 text-primary mx-auto mb-2 flex size-12 items-center justify-center rounded-full">
            <MailIcon className="size-6" />
          </div>
          <CardTitle className="text-center text-2xl">Revisá tu email</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {email ? (
            <p>
              Te enviamos un link de confirmación a{' '}
              <span className="text-foreground font-medium break-all">{email}</span>.
            </p>
          ) : (
            <p>Te enviamos un link de confirmación a tu casilla.</p>
          )}
          <p className="text-muted-foreground">
            Revisá tu inbox (y la carpeta de spam). El link expira en 24 horas.
          </p>
          <p className="text-muted-foreground border-t pt-4">
            ¿Email equivocado?{' '}
            <Link href="/signup" className="text-foreground font-medium hover:underline">
              Crear otra cuenta
            </Link>
          </p>
        </CardContent>
      </Card>
      <p className="text-muted-foreground text-center text-sm">
        <Link href="/" className="hover:text-foreground">
          ← Volver a la home
        </Link>
      </p>
    </div>
  );
}
