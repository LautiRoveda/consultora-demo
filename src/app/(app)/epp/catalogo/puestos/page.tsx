import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/shared/supabase/server';
import { Button } from '@/shared/ui/button';

import { CatalogoTabsNav } from '../CatalogoTabsNav';
import { IncludeArchivedToggle } from '../IncludeArchivedToggle';
import { PuestosList } from '../PuestosList';
import { listPuestos } from '../queries';

type SearchParams = { archived?: string };

export default async function PuestosTabPage({
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
  const puestos = await listPuestos(supabase, { includeArchived });

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-sm">
          Puestos laborales del padrón — base para asignar EPP por puesto en T-103+.
        </p>
        <Button asChild>
          <Link href="/epp/catalogo/puestos/nuevo">Nuevo puesto</Link>
        </Button>
      </div>
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CatalogoTabsNav activeKey="puestos" />
        <IncludeArchivedToggle checked={includeArchived} basePath="/epp/catalogo/puestos" />
      </div>
      <PuestosList puestos={puestos} />
    </div>
  );
}
