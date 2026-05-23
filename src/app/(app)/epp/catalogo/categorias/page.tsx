import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/shared/supabase/server';
import { Button } from '@/shared/ui/button';

import { CatalogoTabsNav } from '../CatalogoTabsNav';
import { CategoriasList } from '../CategoriasList';
import { IncludeArchivedToggle } from '../IncludeArchivedToggle';
import { listCategorias } from '../queries';

type SearchParams = { archived?: string };

export default async function CategoriasTabPage({
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
  const categorias = await listCategorias(supabase, { includeArchived });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Catálogo EPP</h1>
          <p className="text-muted-foreground text-sm">
            Agrupaciones para organizar tu padrón de items (protección cabeza, manos, pies…).
          </p>
        </div>
        <Button asChild>
          <Link href="/epp/catalogo/categorias/nuevo">Nueva categoría</Link>
        </Button>
      </div>
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CatalogoTabsNav activeKey="categorias" />
        <IncludeArchivedToggle checked={includeArchived} basePath="/epp/catalogo/categorias" />
      </div>
      <CategoriasList categorias={categorias} />
    </div>
  );
}
