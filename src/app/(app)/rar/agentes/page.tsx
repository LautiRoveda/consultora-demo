import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/shared/supabase/server';
import { Button } from '@/shared/ui/button';

import { AgentesList } from '../AgentesList';
import { listAgentesByConsultora } from '../queries';
import { RarTabsNav } from '../RarTabsNav';
import { SeedCatalogoButton } from '../SeedCatalogoButton';

type SearchParams = { archived?: string };

export const metadata = { title: 'Agentes de riesgo · RAR' };

export default async function AgentesTabPage({
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
  const agentes = await listAgentesByConsultora(supabase, { includeArchived });
  const hayActivos = agentes.some((a) => a.archived_at === null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Agentes de riesgo</h1>
        <p className="text-muted-foreground text-sm">
          Catálogo de agentes de riesgo (Dto 658/96) para el Relevamiento de Agentes de Riesgo
          (RAR). Sembrá el catálogo recomendado o creá los tuyos.
        </p>
      </div>

      <RarTabsNav activeKey="agentes" />

      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href={includeArchived ? '/rar/agentes' : '/rar/agentes?archived=1'}
          className="text-muted-foreground hover:text-foreground text-sm underline"
        >
          {includeArchived ? 'Ocultar archivados' : 'Mostrar archivados'}
        </Link>
        <div className="flex flex-wrap gap-2">
          <SeedCatalogoButton />
          <Button asChild>
            <Link href="/rar/agentes/nuevo">Nuevo agente</Link>
          </Button>
        </div>
      </div>

      {!hayActivos && !includeArchived ? (
        <div className="space-y-4 rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground text-sm">
            Tu catálogo de agentes está vacío. Sembrá el catálogo recomendado (códigos ESOP reales
            de la Res SRT 81/2019) o creá agentes manualmente.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <SeedCatalogoButton variant="default" label="Sembrar catálogo recomendado" />
            <Button asChild variant="outline">
              <Link href="/rar/agentes/nuevo">Crear primer agente</Link>
            </Button>
          </div>
        </div>
      ) : (
        <AgentesList agentes={agentes} />
      )}
    </div>
  );
}
