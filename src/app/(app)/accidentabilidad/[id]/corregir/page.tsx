import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { createClient } from '@/shared/supabase/server';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';

import { getClientesForConsultora } from '../../../clientes/queries';
import { IncidenteForm } from '../../IncidenteForm';
import { getIncidenteById, listEmpleadosForIncidenteForm } from '../../queries';

/**
 * T-063 · Corregir un incidente. Crea una versión corregida (nuevo registro con
 * `corrige_id`) — la anterior queda en el historial. Sólo se corrige la cabeza
 * vigente: si el registro ya fue corregido/anulado, bloqueamos con un aviso +
 * link al detalle (sin walk-forward a la cabeza, decisión MVP).
 */
export default async function CorregirIncidentePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const result = await getIncidenteById(supabase, id);
  if (!result) notFound();
  const { incidente, esVigente } = result;

  if (!esVigente) {
    return (
      <div className="max-w-3xl space-y-6">
        <div>
          <p className="text-muted-foreground text-sm">
            <Link
              href={`/accidentabilidad/${id}`}
              className="hover:text-foreground hover:underline"
            >
              ← Volver al detalle
            </Link>
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance break-words">
            No se puede corregir
          </h1>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <p className="text-muted-foreground max-w-md text-sm">
              Este registro fue corregido o anulado. Sólo se puede corregir la versión vigente del
              incidente.
            </p>
            <Button asChild>
              <Link href={`/accidentabilidad/${id}`}>Ver detalle</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const [clientes, empleados] = await Promise.all([
    getClientesForConsultora(supabase, { includeArchived: false }),
    listEmpleadosForIncidenteForm(supabase),
  ]);
  const clienteOptions = clientes.map((c) => ({ id: c.id, razon_social: c.razon_social }));

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          <Link
            href={`/accidentabilidad/${incidente.id}`}
            className="hover:text-foreground hover:underline"
          >
            ← Volver al detalle
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance break-words">
          Corregir incidente
        </h1>
        <p className="text-muted-foreground text-sm">
          Se crea una versión corregida; la anterior queda registrada en el historial.
        </p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <IncidenteForm
            mode="corregir"
            corrigeId={incidente.id}
            initialValues={incidente}
            clientes={clienteOptions}
            empleados={empleados}
          />
        </CardContent>
      </Card>
    </div>
  );
}
