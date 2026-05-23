import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';
import { Button } from '@/shared/ui/button';

import { EntregasList } from './EntregasList';
import { listEntregasByConsultora } from './queries';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function EntregasPage({
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
  const empleadoId = typeof params.empleado === 'string' ? params.empleado : undefined;
  const clienteId = typeof params.cliente === 'string' ? params.cliente : undefined;
  const includeUnsigned = params.includeUnsigned === '1';

  const entregas = await listEntregasByConsultora(supabase, {
    empleadoId,
    clienteId,
    includeUnsigned,
  });

  return (
    <div className="max-w-5xl space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Entregas EPP</h1>
          <p className="text-sm text-muted-foreground">
            Registro firmado de entregas (Res SRT 299/11). Cada entrega es inmutable post-firma.
          </p>
        </div>
        {consultora.role === 'owner' && (
          <Button asChild>
            <Link href="/epp/entregas/nueva">Nueva entrega</Link>
          </Button>
        )}
      </header>

      <EntregasList entregas={entregas} />
    </div>
  );
}
