import type { EntregaListItem } from './queries';
import Link from 'next/link';

import { Badge } from '@/shared/ui/badge';
import { Card, CardContent } from '@/shared/ui/card';

export type EntregaCardProps = {
  entrega: EntregaListItem;
};

const dateFormatter = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

export function EntregaCard({ entrega }: EntregaCardProps) {
  const fecha = dateFormatter.format(new Date(entrega.fecha_entrega));
  const firmada = entrega.firmado_at !== null;

  return (
    <Link
      href={`/epp/entregas/${entrega.id}`}
      className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="transition-colors hover:bg-muted/30">
        <CardContent className="grid gap-2 pt-6">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-medium">
                {entrega.empleado_apellido}, {entrega.empleado_nombre}
              </div>
              <div className="text-sm text-muted-foreground">{entrega.cliente_razon_social}</div>
            </div>
            <Badge variant={firmada ? 'default' : 'secondary'}>
              {firmada ? 'Firmada' : 'Pendiente'}
            </Badge>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Entrega del {fecha}</span>
            <span>
              {entrega.items_count} {entrega.items_count === 1 ? 'item' : 'items'}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
