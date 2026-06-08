import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getClienteById } from '@/app/(app)/clientes/queries';
import { listPuestos } from '@/app/(app)/epp/catalogo/queries';
import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';
import { Card, CardContent } from '@/shared/ui/card';

import { EmpleadoForm } from '../../EmpleadoForm';
import { getEmpleadoById } from '../../queries';
import { listPuestosAsignados } from '../puestos/queries';

/**
 * T-054 · Editar empleado. Server Component fetcha el empleado + cliente padre
 * vía RLS (cross-tenant → null → notFound) y delega al form con `mode="edit"`
 * + initialValues pre-populados.
 */
export default async function EditarEmpleadoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) redirect('/empleados');

  const empleado = await getEmpleadoById(supabase, id);
  if (!empleado) notFound();

  const cliente = await getClienteById(supabase, empleado.cliente_id);
  if (!cliente) notFound();

  // T-128 · catálogo activo + puestos ya asignados (join). Espejo single:
  // con exactamente 1 asignado, el selector lo pre-selecciona; si ese puesto
  // está archivado (no aparece en el catálogo activo), lo mergeamos para que el
  // combobox pueda etiquetarlo. Con 0 o ≥2 → `puestoAsignadoId` queda null.
  let catalogoPuestos = (await listPuestos(supabase)).map((p) => ({ id: p.id, nombre: p.nombre }));
  const asignados = await listPuestosAsignados(supabase, empleado.id);
  const asignadosCount = asignados.length;
  let puestoAsignadoId: string | null = null;
  if (asignadosCount === 1) {
    const unico = asignados[0]!;
    puestoAsignadoId = unico.puesto_id;
    if (!catalogoPuestos.some((p) => p.id === unico.puesto_id)) {
      catalogoPuestos = [...catalogoPuestos, { id: unico.puesto_id, nombre: unico.nombre }];
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          <Link
            href={`/empleados/${empleado.id}`}
            className="hover:text-foreground hover:underline"
          >
            ← Volver al detalle
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance break-words">
          Editar empleado
        </h1>
        <p className="text-muted-foreground text-sm">
          Modificá los datos de {empleado.apellido}, {empleado.nombre}. Solo se guardan los cambios.
        </p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <EmpleadoForm
            mode="edit"
            empleadoId={empleado.id}
            clienteId={cliente.id}
            clienteRazonSocial={cliente.razon_social}
            initialValues={empleado}
            catalogoPuestos={catalogoPuestos}
            canCrearPuesto={consultora.role === 'owner'}
            puestoAsignadoId={puestoAsignadoId}
            asignadosCount={asignadosCount}
          />
        </CardContent>
      </Card>
    </div>
  );
}
