import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getClienteById, getClientesForConsultora } from '@/app/(app)/clientes/queries';
import { createClient } from '@/shared/supabase/server';
import { Button } from '@/shared/ui/button';

import { ClientesIndexList } from './ClientesIndexList';
import { EmpleadosList } from './EmpleadosList';
import { getEmpleadosByCliente } from './queries';

type SearchParams = { cliente_id?: string; archived?: string; q?: string };

/**
 * Orquesta el render condicional de `/empleados`:
 * - sin `cliente_id` → landing con índice de clientes.
 * - con `cliente_id` → lista de empleados de ese cliente.
 *
 * Si `cliente_id` no matchea ningún cliente del tenant (RLS → null) → notFound.
 */
export async function EmpleadosListContainer({ searchParams }: { searchParams: SearchParams }) {
  const supabase = await createClient();

  const clienteId = searchParams.cliente_id?.trim();
  if (!clienteId) {
    const clientes = await getClientesForConsultora(supabase);
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-balance break-words">
              Empleados
            </h1>
            <p className="text-muted-foreground text-sm">
              Elegí un cliente para ver y administrar sus empleados.
            </p>
          </div>
        </div>
        <ClientesIndexList clientes={clientes} />
      </div>
    );
  }

  const cliente = await getClienteById(supabase, clienteId);
  if (!cliente) notFound();

  const includeArchived = searchParams.archived === '1';
  const q = (searchParams.q ?? '').trim();
  const empleados = await getEmpleadosByCliente(supabase, cliente.id, { includeArchived });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <p className="text-muted-foreground text-sm">
            <Link href="/empleados" className="hover:text-foreground hover:underline">
              ← Volver a Empleados
            </Link>
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-balance break-words">
            Empleados de {cliente.razon_social}
          </h1>
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
      />
    </div>
  );
}
