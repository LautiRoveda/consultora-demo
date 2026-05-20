import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { EmpleadosList } from '@/app/(app)/empleados/EmpleadosList';
import { getEmpleadosByCliente } from '@/app/(app)/empleados/queries';
import { createClient } from '@/shared/supabase/server';
import { Button } from '@/shared/ui/button';

import { getClienteById } from '../../queries';
import { ClienteDetailHeader } from '../ClienteDetailHeader';
import { ClienteTabsNav } from '../ClienteTabsNav';

type SearchParams = { archived?: string; q?: string };

/**
 * T-055 · Tab Empleados del detail view del cliente.
 *
 * Reusa `EmpleadosList` (T-054) pasando `listBasePath` para que el debounce
 * search + toggle archivados naveguen a `/clientes/[id]/empleados?...` en vez
 * de `/empleados?cliente_id=...`. Sub-header (h2 + CTA "Nuevo empleado") solo
 * si hay empleados — matchea el patrón de `EmpleadosListContainer` standalone.
 *
 * URL state: `?archived=1&q=foo` (sin `cliente_id` en query — va en path).
 */
export default async function ClienteEmpleadosTabPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const cliente = await getClienteById(supabase, id);
  if (!cliente) notFound();

  const includeArchived = sp.archived === '1';
  const q = (sp.q ?? '').trim();
  const empleados = await getEmpleadosByCliente(supabase, cliente.id, { includeArchived });

  const listBasePath = `/clientes/${cliente.id}/empleados`;

  return (
    <div className="max-w-4xl space-y-6">
      <ClienteDetailHeader cliente={cliente} />
      <ClienteTabsNav clienteId={cliente.id} />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">Empleados</h2>
          <p className="text-muted-foreground text-sm">
            Cargá los empleados de este cliente — los vas a usar al generar planillas de EPP (Res
            299/11) o capacitaciones.
          </p>
        </div>
        {empleados.length > 0 && (
          <Button asChild>
            <Link href={`/empleados/nuevo?cliente_id=${cliente.id}`}>Nuevo empleado</Link>
          </Button>
        )}
      </div>

      <EmpleadosList
        clienteId={cliente.id}
        empleados={empleados}
        initialQ={q}
        initialIncludeArchived={includeArchived}
        listBasePath={listBasePath}
      />
    </div>
  );
}
