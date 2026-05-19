import type { ClienteRow } from '@/app/(app)/clientes/queries';
import Link from 'next/link';

import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';

/**
 * Landing `/empleados` sin `cliente_id`: índice de clientes activos del tenant.
 * Cada card linkea a `/empleados?cliente_id=<id>` que muestra la lista de
 * empleados de ese cliente.
 *
 * Decisión arquitectural T-054: no existe lista global cross-cliente. UX matchea
 * el mental model HyS — el consultor piensa "los empleados de cliente X".
 */
export function ClientesIndexList({ clientes }: { clientes: ClienteRow[] }) {
  if (clientes.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="space-y-1">
            <p className="text-foreground text-sm font-medium">
              Necesitás un cliente antes de cargar empleados
            </p>
            <p className="text-muted-foreground max-w-md text-sm">
              Los empleados se organizan por cliente. Empezá creando uno y después cargás sus
              empleados.
            </p>
          </div>
          <Button asChild>
            <Link href="/clientes/nuevo">Crear primer cliente</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="space-y-3">
      {clientes.map((c) => (
        <li key={c.id}>
          <Link
            href={`/empleados?cliente_id=${c.id}`}
            className="hover:bg-accent block rounded-lg border p-4 transition-colors"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <p className="text-foreground font-medium">{c.razon_social}</p>
                <p className="text-muted-foreground text-sm">
                  {c.cuit} · {c.nombre_fantasia ?? '—'}
                </p>
              </div>
              <span className="text-muted-foreground text-sm">Ver empleados →</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
