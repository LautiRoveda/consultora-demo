import Link from 'next/link';

import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

/**
 * T-061a · Card del final del runner (última sección). El cierre con firma es del
 * owner y vive en `/[id]/cerrar` (T-061b). Acá solo mostramos completitud y, para
 * el member, la instrucción de pedir el cierre al titular.
 */
export function ReadyToCloseCard({
  executionId,
  isOwner,
  answeredRequired,
  totalRequired,
}: {
  executionId: string;
  isOwner: boolean;
  answeredRequired: number;
  totalRequired: number;
}) {
  const complete = answeredRequired >= totalRequired;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{complete ? 'Relevamiento completo' : 'Relevamiento en curso'}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <p className="text-muted-foreground">
          {answeredRequired} de {totalRequired} ítems obligatorios respondidos.
          {!complete && ' Faltan obligatorios para poder cerrar.'}
        </p>

        {isOwner ? (
          complete ? (
            // T-061b · CTA del owner: cierre con firma.
            <Button asChild>
              <Link href={`/checklists/ejecuciones/${executionId}/cerrar`}>
                Cerrar y firmar inspección
              </Link>
            </Button>
          ) : (
            <div className="bg-muted/30 rounded-md border p-3">
              <p className="font-medium">Cierre con firma</p>
              <p className="text-muted-foreground">
                Respondé los ítems obligatorios para poder cerrar y firmar la inspección.
              </p>
            </div>
          )
        ) : (
          <div className="bg-muted/30 rounded-md border p-3">
            <p className="font-medium">Listo para cerrar</p>
            <p className="text-muted-foreground">
              Pedile al titular de la consultora que firme y cierre la inspección.
            </p>
          </div>
        )}

        <Button asChild variant="outline">
          <Link href="/checklists/ejecuciones">Volver a inspecciones</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
