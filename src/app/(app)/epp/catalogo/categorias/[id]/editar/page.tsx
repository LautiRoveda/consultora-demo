import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';
import { Card, CardContent } from '@/shared/ui/card';

import { CategoriaForm } from '../../../CategoriaForm';
import { getCategoriaById } from '../../../queries';

export default async function EditarCategoriaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) redirect('/dashboard');
  if (consultora.role !== 'owner') redirect('/epp/catalogo/categorias');

  const categoria = await getCategoriaById(supabase, id);
  if (!categoria) notFound();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          <Link href="/epp/catalogo/categorias" className="hover:text-foreground hover:underline">
            ← Volver a Categorías
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Editar categoría</h1>
        <p className="text-muted-foreground text-sm">{categoria.nombre}</p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <CategoriaForm mode="edit" categoriaId={categoria.id} initialValues={categoria} />
        </CardContent>
      </Card>
    </div>
  );
}
