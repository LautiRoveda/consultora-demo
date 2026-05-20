'use client';

import * as Sentry from '@sentry/nextjs';
import Link from 'next/link';
import { useEffect } from 'react';

import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';

/**
 * T-095 · Error boundary del route group `(app)`.
 *
 * Captura excepciones que escapan de cualquier page autenticada y las reporta
 * a Sentry. El shell autenticado (sidebar + header) sigue visible porque
 * este boundary corre debajo del layout `(app)`.
 *
 * Para errores que rompen el root layout (cuando este boundary también
 * falla), `src/app/global-error.tsx` actúa como fallback final.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <Card className="mx-auto mt-12 max-w-md">
      <CardContent className="space-y-4 py-8 text-center">
        <h2 className="text-xl font-semibold">Algo salió mal</h2>
        <p className="text-muted-foreground text-sm">
          Hubo un problema cargando esta sección. Reintentá o volvé al dashboard.
        </p>
        <div className="flex justify-center gap-2 pt-2">
          <Button variant="outline" onClick={reset}>
            Reintentar
          </Button>
          <Button asChild>
            <Link href="/dashboard">Ir al dashboard</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
