import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';

import { listClientesConEmpleados, listEmpleadosConEstadoEpp } from './queries';

/**
 * T-106 · Padrón de empleados del módulo EPP.
 *
 * Vista landing del módulo: tabla con estado EPP por empleado (puestos
 * asignados + última entrega + items con vencimiento en 30 días). Cada row
 * linkea al detail empleado, donde está la Card de sugerencia IA.
 *
 * Filtro opcional `?cliente=<uuid>` para vista filtrada (mismo pattern que
 * `/empleados` y `/epp/entregas`). RLS scope.
 */

type SearchParams = Record<string, string | string[] | undefined>;

export default async function EppPadronPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) redirect('/dashboard');

  const params = (await searchParams) ?? {};
  const clienteFilter = typeof params.cliente === 'string' ? params.cliente : undefined;

  const [empleados, clientes] = await Promise.all([
    listEmpleadosConEstadoEpp(supabase, { clienteId: clienteFilter }),
    listClientesConEmpleados(supabase),
  ]);

  const clienteActivo = clienteFilter
    ? clientes.find((c) => c.id === clienteFilter)?.razon_social
    : undefined;

  if (empleados.length === 0 && !clienteFilter) {
    return (
      <div className="max-w-3xl space-y-3">
        <p className="text-sm text-muted-foreground">
          Todavía no cargaste empleados. Empezá por dar de alta clientes y empleados desde el módulo
          correspondiente.
        </p>
        <Button asChild variant="outline">
          <Link href="/clientes">Ir a Clientes →</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl space-y-4">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {empleados.length} empleado{empleados.length === 1 ? '' : 's'} activo
          {empleados.length === 1 ? '' : 's'}
          {clienteActivo ? ` de ${clienteActivo}` : ''}. Tocá un empleado para ver detalle y pedir
          sugerencia EPP (IA).
        </p>
        <ClienteFilter clientes={clientes} activeClienteId={clienteFilter} />
      </header>

      {empleados.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin empleados para los filtros aplicados.</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empleado</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-center">Puestos</TableHead>
                <TableHead>Última entrega</TableHead>
                <TableHead className="text-center">Pendientes 30d</TableHead>
                <TableHead className="text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {empleados.map((e) => (
                <TableRow key={e.empleado_id} data-testid={`padron-row-${e.empleado_id}`}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {e.empleado_apellido}, {e.empleado_nombre}
                      </span>
                      <span className="text-xs text-muted-foreground">DNI {e.empleado_dni}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/empleados?cliente_id=${e.cliente_id}`}
                      className="text-sm hover:underline"
                    >
                      {e.cliente_razon_social}
                    </Link>
                  </TableCell>
                  <TableCell className="text-center">
                    {e.puestos_count === 0 ? (
                      <Badge variant="outline" className="text-muted-foreground">
                        sin puestos
                      </Badge>
                    ) : (
                      <Badge variant="secondary">{e.puestos_count}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {e.ultima_entrega ? (
                      <span className="text-sm">{formatDate(e.ultima_entrega)}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">sin entregas</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {e.pendientes_proximos_count === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <Badge variant="default">{e.pendientes_proximos_count}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/empleados/${e.empleado_id}`}>Ver →</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function ClienteFilter({
  clientes,
  activeClienteId,
}: {
  clientes: Array<{ id: string; razon_social: string }>;
  activeClienteId?: string;
}) {
  if (clientes.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Filtrar:</span>
      <Button asChild size="sm" variant={!activeClienteId ? 'default' : 'outline'}>
        <Link href="/epp/padron">Todos</Link>
      </Button>
      {clientes.slice(0, 6).map((c) => (
        <Button
          key={c.id}
          asChild
          size="sm"
          variant={activeClienteId === c.id ? 'default' : 'outline'}
        >
          <Link href={`/epp/padron?cliente=${c.id}`}>{c.razon_social}</Link>
        </Button>
      ))}
    </div>
  );
}

function formatDate(iso: string): string {
  // Postgres date columns vienen como 'YYYY-MM-DD'. Display friendly DD/MM/YYYY.
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
