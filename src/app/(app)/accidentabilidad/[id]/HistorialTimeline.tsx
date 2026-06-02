import type { IncidenteRow } from '../queries';

import { Badge } from '@/shared/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

import { formatTimestampEs } from '../labels';

/**
 * T-063 · Historial read-only de la cadena de correcciones (más nueva → más
 * vieja). Cada entrada es una versión previa que fue superseded. El libro es
 * append-only: nada acá se edita.
 */
export function HistorialTimeline({ historial }: { historial: IncidenteRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Historial de correcciones</CardTitle>
        <CardDescription>
          {historial.length === 1
            ? '1 versión previa de este registro.'
            : `${historial.length} versiones previas de este registro.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="border-muted space-y-4 border-l pl-4">
          {historial.map((h) => (
            <li key={h.id} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={h.anulacion ? 'outline' : 'secondary'}>
                  {h.anulacion ? 'Anulación' : 'Versión previa'}
                </Badge>
                <time className="text-muted-foreground text-xs" dateTime={h.created_at}>
                  {formatTimestampEs(h.created_at)}
                </time>
              </div>
              <p className="text-sm whitespace-pre-wrap">{h.descripcion}</p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
