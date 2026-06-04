import { Badge } from '@/shared/ui/badge';

/**
 * T-061a · Badge del estado de una inspección. Reusado en el listado y en el
 * placeholder de inspección cerrada/anulada ([id]/page.tsx). El detalle completo
 * (T-061b) lo reusa también.
 */
export function EjecucionEstadoBadge({ estado }: { estado: string }) {
  switch (estado) {
    case 'borrador':
      return <Badge variant="secondary">Borrador</Badge>;
    case 'cerrada':
      return <Badge variant="default">Cerrada</Badge>;
    case 'anulada':
      return <Badge variant="outline">Anulada</Badge>;
    default:
      return <Badge variant="outline">{estado}</Badge>;
  }
}
