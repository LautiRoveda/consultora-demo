import type { EmptyEntregasReason } from '../EmptyEntregasState';
import { redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';

import { EmptyEntregasState } from '../EmptyEntregasState';
import { EntregaWizard } from '../EntregaWizard';
import {
  countEntregasContext,
  listEmpleadosForEntregaWizard,
  listItemsForEntregaWizard,
} from '../queries';

export default async function NuevaEntregaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) redirect('/dashboard');

  if (consultora.role !== 'owner') {
    // Member non-owner: la creación está vedada por server action; redirigimos
    // a la lista (read-only para él) en lugar de mostrar el wizard.
    redirect('/epp/entregas');
  }

  const counts = await countEntregasContext(supabase, consultora.id);

  if (counts.items === 0 || counts.empleados === 0) {
    let reason: EmptyEntregasReason = 'both';
    if (counts.items > 0 && counts.empleados === 0) reason = 'no-empleados';
    else if (counts.items === 0 && counts.empleados > 0) reason = 'no-catalog';

    return (
      <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Nueva entrega EPP</h1>
          <p className="text-sm text-muted-foreground">
            Antes de registrar la primera entrega necesitamos algunos datos.
          </p>
        </div>
        <EmptyEntregasState reason={reason} />
      </div>
    );
  }

  const [empleados, items] = await Promise.all([
    listEmpleadosForEntregaWizard(supabase),
    listItemsForEntregaWizard(supabase),
  ]);

  return (
    <div className="space-y-6">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Nueva entrega EPP</h1>
        <p className="text-sm text-muted-foreground">
          Seleccioná el empleado, registrá los items entregados y obtené la firma del operario.
        </p>
      </div>
      <EntregaWizard empleados={empleados} items={items} />
    </div>
  );
}
