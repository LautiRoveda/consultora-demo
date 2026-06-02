import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/shared/supabase/server';
import { Card, CardContent } from '@/shared/ui/card';

import { getClientesForConsultora } from '../../clientes/queries';
import { IncidenteForm } from '../IncidenteForm';
import { listEmpleadosForIncidenteForm } from '../queries';

/**
 * T-063 · Registrar incidente. Server Component carga las opciones de FK
 * (clientes activos + empleados del tenant) y delega al form (Client — RHF +
 * zodResolver requieren browser side).
 */
export default async function NuevoIncidentePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [clientes, empleados] = await Promise.all([
    getClientesForConsultora(supabase, { includeArchived: false }),
    listEmpleadosForIncidenteForm(supabase),
  ]);
  const clienteOptions = clientes.map((c) => ({ id: c.id, razon_social: c.razon_social }));

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          <Link href="/accidentabilidad" className="hover:text-foreground hover:underline">
            ← Volver a Accidentabilidad
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance break-words">
          Registrar incidente
        </h1>
        <p className="text-muted-foreground text-sm">
          Cargá el casi-accidente o accidente. Los campos opcionales podés completarlos después.
        </p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <IncidenteForm mode="create" clientes={clienteOptions} empleados={empleados} />
        </CardContent>
      </Card>
    </div>
  );
}
