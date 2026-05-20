import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getClienteById } from '@/app/(app)/clientes/queries';
import { createClient } from '@/shared/supabase/server';
import { Card, CardContent } from '@/shared/ui/card';

import { EmpleadoForm } from '../EmpleadoForm';

type SearchParams = { cliente_id?: string };

/**
 * T-054 · Crear empleado. Server Component delega al form (Client) — RHF +
 * zodResolver requieren browser side.
 *
 * Sin `cliente_id` → redirect a `/empleados` (no se puede crear empleado
 * suelto, siempre va vinculado a un cliente). Si `cliente_id` no existe en
 * el tenant → notFound (RLS-aware via getClienteById).
 */
export default async function NuevoEmpleadoPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const clienteId = sp.cliente_id?.trim();
  if (!clienteId) redirect('/empleados');

  const cliente = await getClienteById(supabase, clienteId);
  if (!cliente) notFound();

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          <Link
            href={`/empleados?cliente_id=${cliente.id}`}
            className="hover:text-foreground hover:underline"
          >
            ← Volver a Empleados de {cliente.razon_social}
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance break-words">
          Nuevo empleado
        </h1>
        <p className="text-muted-foreground text-sm">
          Cargá los datos del empleado — los campos opcionales podés completarlos después.
        </p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <EmpleadoForm
            mode="create"
            clienteId={cliente.id}
            clienteRazonSocial={cliente.razon_social}
          />
        </CardContent>
      </Card>
    </div>
  );
}
