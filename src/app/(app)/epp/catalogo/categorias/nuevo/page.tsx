import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';
import { Card, CardContent } from '@/shared/ui/card';

import { CategoriaForm } from '../../CategoriaForm';

export default async function NuevaCategoriaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) redirect('/dashboard');
  if (consultora.role !== 'owner') redirect('/epp/catalogo/categorias');

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          <Link href="/epp/catalogo/categorias" className="hover:text-foreground hover:underline">
            ← Volver a Categorías
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Nueva categoría</h1>
        <p className="text-muted-foreground text-sm">Agrupación de items EPP de tu catálogo.</p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <CategoriaForm mode="create" />
        </CardContent>
      </Card>
    </div>
  );
}
