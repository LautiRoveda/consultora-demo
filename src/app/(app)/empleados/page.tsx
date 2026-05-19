import { redirect } from 'next/navigation';

import { createClient } from '@/shared/supabase/server';

import { EmpleadosListContainer } from './EmpleadosListContainer';

type SearchParams = { cliente_id?: string; archived?: string; q?: string };

/**
 * T-054 · Módulo Empleados — landing condicional.
 *
 * Sin `cliente_id` → índice de clientes. Con `cliente_id` → lista de empleados
 * del cliente. Decisión arquitectural cerrada: no existe lista global cross-
 * cliente (matchea mental model HyS + reusa `getEmpleadosByCliente` ya
 * existente en T-053).
 */
export default async function EmpleadosPage({
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

  return <EmpleadosListContainer searchParams={sp} />;
}
