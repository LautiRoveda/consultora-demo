import type { ClienteRow } from './queries';
import Link from 'next/link';

import { Badge } from '@/shared/ui/badge';

import { formatDateEs, isArchived, provinciaLabel } from './labels';

/**
 * Densidad fija: placeholders `'—'` en cada slot vacío (decision Lautaro). Razón:
 * ritmo visual estable + escaneo rápido en lista de 20-65 clientes + card altura
 * constante preserva grid + estándar admin tables (Linear/Notion).
 */
export function ClienteListCard({ cliente }: { cliente: ClienteRow }) {
  const provincia = provinciaLabel(cliente.provincia) ?? '—';
  return (
    <Link
      href={`/clientes/${cliente.id}`}
      className="hover:bg-accent block rounded-lg border p-4 transition-colors"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-foreground font-medium">{cliente.razon_social}</p>
          <p className="text-muted-foreground text-sm">
            {cliente.cuit} · {cliente.nombre_fantasia ?? '—'} · {cliente.industria ?? '—'}
          </p>
          <p className="text-muted-foreground text-xs">
            {cliente.localidad ?? '—'}, {provincia}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {isArchived(cliente) && <Badge variant="secondary">Archivado</Badge>}
          <time className="text-muted-foreground text-xs" dateTime={cliente.created_at}>
            {formatDateEs(cliente.created_at)}
          </time>
        </div>
      </div>
    </Link>
  );
}
