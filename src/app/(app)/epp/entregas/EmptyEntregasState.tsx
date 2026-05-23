import { ClipboardSignature, HardHat, Users } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

export type EmptyEntregasReason = 'no-catalog' | 'no-empleados' | 'both';

export type EmptyEntregasStateProps = {
  reason: EmptyEntregasReason;
};

export function EmptyEntregasState({ reason }: EmptyEntregasStateProps) {
  const needsCatalog = reason === 'no-catalog' || reason === 'both';
  const needsEmpleados = reason === 'no-empleados' || reason === 'both';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="bg-muted flex h-10 w-10 items-center justify-center rounded-lg">
            <ClipboardSignature className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <CardTitle>Necesitamos algo antes de la primera entrega</CardTitle>
            <CardDescription>
              Cargá{' '}
              {needsCatalog && needsEmpleados
                ? 'catálogo y empleados'
                : needsCatalog
                  ? 'el catálogo EPP'
                  : 'al menos un empleado'}{' '}
              para registrar entregas firmadas.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {needsCatalog && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="mb-1 flex items-center gap-2 font-medium">
              <HardHat className="h-4 w-4" aria-hidden /> Catálogo EPP vacío
            </div>
            <p className="text-muted-foreground">
              Cargá categorías, items (cascos, guantes, arneses…) y puestos para poder asignarlos en
              las entregas.
            </p>
          </div>
        )}
        {needsEmpleados && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="mb-1 flex items-center gap-2 font-medium">
              <Users className="h-4 w-4" aria-hidden /> Sin empleados activos
            </div>
            <p className="text-muted-foreground">
              La entrega va dirigida a un empleado puntual. Creá al menos uno (vinculado a un
              cliente) antes de registrar entregas.
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {needsCatalog && (
            <Button asChild>
              <Link href="/epp/catalogo">Cargar catálogo EPP</Link>
            </Button>
          )}
          {needsEmpleados && (
            <Button asChild variant={needsCatalog ? 'outline' : 'default'}>
              <Link href="/empleados/nuevo">Crear empleado</Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
