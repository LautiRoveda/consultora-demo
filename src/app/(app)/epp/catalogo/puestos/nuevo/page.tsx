import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';
import { Card, CardContent } from '@/shared/ui/card';

import { PuestoForm } from '../../PuestoForm';

export default async function NuevoPuestoPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) redirect('/dashboard');
  if (consultora.role !== 'owner') redirect('/epp/catalogo/puestos');

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          <Link href="/epp/catalogo/puestos" className="hover:text-foreground hover:underline">
            ← Volver a Puestos
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Nuevo puesto</h1>
        <p className="text-muted-foreground text-sm">
          Puesto laboral del padrón. Más adelante vas a asignar empleados y EPP recomendado.
        </p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <PuestoForm mode="create" />
        </CardContent>
      </Card>
    </div>
  );
}
