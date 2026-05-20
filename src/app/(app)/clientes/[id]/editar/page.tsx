import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { createClient } from '@/shared/supabase/server';
import { Card, CardContent } from '@/shared/ui/card';

import { ClienteForm } from '../../ClienteForm';
import { getClienteById } from '../../queries';

/**
 * T-049 · Editar cliente. Server Component fetcha el cliente vía RLS (cross-
 * tenant → null → notFound) y delega al form con `mode="edit"` + initialValues
 * pre-populados.
 */
export default async function EditarClientePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const cliente = await getClienteById(supabase, id);
  if (!cliente) notFound();

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          <Link href={`/clientes/${cliente.id}`} className="hover:text-foreground hover:underline">
            ← Volver al detalle
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance break-words">
          Editar cliente
        </h1>
        <p className="text-muted-foreground text-sm">
          Modificá los datos de {cliente.razon_social}. Solo se guardan los cambios.
        </p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <ClienteForm mode="edit" clienteId={cliente.id} initialValues={cliente} />
        </CardContent>
      </Card>
    </div>
  );
}
