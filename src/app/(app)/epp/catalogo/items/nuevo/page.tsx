import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';
import { Card, CardContent } from '@/shared/ui/card';

import { ItemForm } from '../../ItemForm';
import { listCategorias } from '../../queries';

export default async function NuevoItemPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) redirect('/dashboard');
  if (consultora.role !== 'owner') redirect('/epp/catalogo/items');

  const categorias = await listCategorias(supabase, { includeArchived: false });
  const opciones = categorias.map((c) => ({ id: c.id, nombre: c.nombre }));

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          <Link href="/epp/catalogo/items" className="hover:text-foreground hover:underline">
            ← Volver a Items
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Nuevo item EPP</h1>
        <p className="text-muted-foreground text-sm">
          Definí el tipo de EPP que vas a poder entregar a empleados.
        </p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <ItemForm mode="create" categorias={opciones} />
        </CardContent>
      </Card>
    </div>
  );
}
