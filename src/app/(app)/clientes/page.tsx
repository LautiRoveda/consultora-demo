import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/shared/supabase/server';
import { Button } from '@/shared/ui/button';

import { ClientesList } from './ClientesList';
import { getClientesForConsultora } from './queries';

type SearchParams = { archived?: string; q?: string };

/**
 * T-049 · Lista de clientes de la consultora del user logueado.
 *
 * Server Component: `getUser` defensivo (el layout `(app)` ya guardea sesion) y
 * fetch via `getClientesForConsultora` que aplica RLS por JWT claim. El search
 * box + toggle "Ver archivados" viven en `ClientesList` (Client Component) con
 * URL state que dispara re-fetch en este server component al hacer push.
 */
export default async function ClientesPage({
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

  const includeArchived = sp.archived === '1';
  const q = (sp.q ?? '').trim();
  const clientes = await getClientesForConsultora(supabase, { includeArchived });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-balance break-words">
            Clientes
          </h1>
          <p className="text-muted-foreground text-sm">
            Gestioná los clientes de tu consultora — al generar informes vas a poder elegirlos del
            listado en lugar de tipear los datos cada vez.
          </p>
        </div>
        {clientes.length > 0 && (
          <Button asChild>
            <Link href="/clientes/nuevo">Nuevo cliente</Link>
          </Button>
        )}
      </div>
      <ClientesList clientes={clientes} initialQ={q} initialIncludeArchived={includeArchived} />
    </div>
  );
}
