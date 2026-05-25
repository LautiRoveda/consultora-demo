import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getClienteById } from '@/app/(app)/clientes/queries';
import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';
import { Badge } from '@/shared/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

import { formatCivilDateEs, formatDateEs, formatDni, isArchived } from '../labels';
import { getEmpleadoById } from '../queries';
import { EmpleadoActionsButtons } from './EmpleadoActionsButtons';
import { listPuestosAsignados, listPuestosDisponiblesParaAsignar } from './puestos/queries';
import { PuestosCard } from './PuestosCard';
import { SugerenciaEppCard } from './SugerenciaEppCard';

/**
 * T-054 · Detalle de empleado (read-only).
 *
 * Cards condicionales: si todos los fields de una sección son null, esa Card
 * NO se renderiza (clean visual). Identificación siempre se muestra porque
 * `nombre` + `apellido` + `dni` son NOT NULL.
 *
 * Permission gate UI matchea RLS T-052/T-053 any-member: todos los botones
 * (Editar/Archivar/Desarchivar) habilitados para cualquier member del tenant.
 */
export default async function EmpleadoDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const empleado = await getEmpleadoById(supabase, id);
  if (!empleado) notFound();

  const cliente = await getClienteById(supabase, empleado.cliente_id);
  // RLS garantiza que si traemos empleado, su cliente también es del tenant.
  // Si por algún drift ese acceso falla → notFound defensivo.
  if (!cliente) notFound();

  const consultora = await getCurrentConsultora(supabase, user.id);
  const [puestosAsignados, puestosDisponibles] = consultora
    ? await Promise.all([
        listPuestosAsignados(supabase, empleado.id),
        listPuestosDisponiblesParaAsignar(supabase, empleado.id, consultora.id),
      ])
    : [[], []];

  const hasContacto = !!(empleado.email || empleado.telefono);
  const hasLaboral = !!(empleado.puesto || empleado.fecha_ingreso || empleado.fecha_nacimiento);

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <p className="text-muted-foreground text-sm">
            <Link
              href={`/empleados?cliente_id=${cliente.id}`}
              className="hover:text-foreground hover:underline"
            >
              ← Volver a Empleados de {cliente.razon_social}
            </Link>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-balance break-words">
              {empleado.apellido}, {empleado.nombre}
            </h1>
            {isArchived(empleado) && <Badge variant="secondary">Archivado</Badge>}
          </div>
          <p className="text-muted-foreground text-sm">
            DNI {formatDni(empleado.dni)} · Creado el {formatDateEs(empleado.created_at)}
          </p>
        </div>
        <EmpleadoActionsButtons
          empleadoId={empleado.id}
          fullName={`${empleado.apellido}, ${empleado.nombre}`}
          archived={isArchived(empleado)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Identificación</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
          <Field label="Apellido" value={empleado.apellido} />
          <Field label="Nombre" value={empleado.nombre} />
          <Field label="DNI" value={formatDni(empleado.dni)} />
          {empleado.cuil && <Field label="CUIL" value={empleado.cuil} />}
        </CardContent>
      </Card>

      {hasContacto && (
        <Card>
          <CardHeader>
            <CardTitle>Contacto</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
            {empleado.email && <Field label="Email" value={empleado.email} />}
            {empleado.telefono && <Field label="Teléfono" value={empleado.telefono} />}
          </CardContent>
        </Card>
      )}

      {hasLaboral && (
        <Card>
          <CardHeader>
            <CardTitle>Laboral</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
            {empleado.puesto && (
              <Field label="Puesto" value={empleado.puesto} className="md:col-span-2" />
            )}
            {empleado.fecha_ingreso && (
              <Field label="Fecha de ingreso" value={formatCivilDateEs(empleado.fecha_ingreso)} />
            )}
            {empleado.fecha_nacimiento && (
              <Field
                label="Fecha de nacimiento"
                value={formatCivilDateEs(empleado.fecha_nacimiento)}
              />
            )}
          </CardContent>
        </Card>
      )}

      {empleado.notas && (
        <Card>
          <CardHeader>
            <CardTitle>Notas internas</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{empleado.notas}</p>
          </CardContent>
        </Card>
      )}

      <PuestosCard
        empleadoId={empleado.id}
        empleadoFullName={`${empleado.apellido}, ${empleado.nombre}`}
        asignados={puestosAsignados}
        disponibles={puestosDisponibles}
      />

      <SugerenciaEppCard
        empleadoId={empleado.id}
        tienePuestos={puestosAsignados.some((p) => p.archived_at === null)}
      />
    </div>
  );
}

function Field({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <p className="text-muted-foreground text-xs tracking-wide uppercase">{label}</p>
      <p>{value}</p>
    </div>
  );
}
