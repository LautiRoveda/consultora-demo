import { ClipboardList } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

/**
 * T-061a · Estado vacío del listado de inspecciones. `hasTemplate` decide si el
 * CTA lleva a iniciar una inspección o a publicar un template primero.
 */
export function EmptyEjecucionesState({ hasPublishedTemplate }: { hasPublishedTemplate: boolean }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="bg-muted flex h-10 w-10 items-center justify-center rounded-lg">
            <ClipboardList className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <CardTitle>Todavía no hay inspecciones</CardTitle>
            <CardDescription>
              {hasPublishedTemplate
                ? 'Iniciá una inspección a partir de un template publicado y relevala en obra.'
                : 'Necesitás un template publicado antes de poder ejecutar una inspección.'}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {hasPublishedTemplate ? (
          <Button asChild>
            <Link href="/checklists/ejecuciones/nueva">Nueva inspección</Link>
          </Button>
        ) : (
          <Button asChild variant="outline">
            <Link href="/checklists">Ir a Checklists</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
