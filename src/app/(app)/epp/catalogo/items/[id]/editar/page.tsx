import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';
import { Card, CardContent } from '@/shared/ui/card';

import { ItemForm } from '../../../ItemForm';
import { getItemById, listCategorias } from '../../../queries';

export default async function EditarItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) redirect('/dashboard');
  if (consultora.role !== 'owner') redirect('/epp/catalogo/items');

  const [item, categorias] = await Promise.all([
    getItemById(supabase, id),
    listCategorias(supabase, { includeArchived: false }),
  ]);
  if (!item) notFound();

  // Si la categoría del item está archivada, agregarla al final con sufijo
  // para que el Select pueda mantener el value actual sin romperse.
  const opciones = categorias.map((c) => ({ id: c.id, nombre: c.nombre }));
  if (!opciones.some((o) => o.id === item.categoria_id)) {
    opciones.push({ id: item.categoria_id, nombre: '(categoría archivada)' });
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          <Link href="/epp/catalogo/items" className="hover:text-foreground hover:underline">
            ← Volver a Items
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Editar item</h1>
        <p className="text-muted-foreground text-sm">{item.nombre}</p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <ItemForm mode="edit" itemId={item.id} initialValues={item} categorias={opciones} />
        </CardContent>
      </Card>
    </div>
  );
}
