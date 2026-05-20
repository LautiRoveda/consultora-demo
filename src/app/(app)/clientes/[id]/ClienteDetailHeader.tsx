import type { ClienteRow } from '../queries';
import Link from 'next/link';

import { Badge } from '@/shared/ui/badge';

import { formatDateEs, isArchived } from '../labels';
import { ClienteActionsButtons } from './ClienteActionsButtons';

interface Props {
  cliente: ClienteRow;
}

/**
 * T-055 · Header compartido entre tab Detalle y tab Empleados del detail view
 * del cliente. Server component — embebe `<ClienteActionsButtons>` (client)
 * como child sin modificarlo.
 */
export function ClienteDetailHeader({ cliente }: Props) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <p className="text-muted-foreground text-sm">
          <Link href="/clientes" className="hover:text-foreground hover:underline">
            ← Volver a Clientes
          </Link>
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{cliente.razon_social}</h1>
          {isArchived(cliente) && <Badge variant="secondary">Archivado</Badge>}
        </div>
        <p className="text-muted-foreground text-sm">
          {cliente.cuit} · Creado el {formatDateEs(cliente.created_at)}
        </p>
      </div>
      <ClienteActionsButtons
        clienteId={cliente.id}
        razonSocial={cliente.razon_social}
        archived={isArchived(cliente)}
      />
    </div>
  );
}
