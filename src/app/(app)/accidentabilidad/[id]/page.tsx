import { notFound, redirect } from 'next/navigation';

import { createClient } from '@/shared/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

import { getClienteById } from '../../clientes/queries';
import { getEmpleadoById } from '../../empleados/queries';
import { formatCivilDateLongAR, gravedadIncidenteLabel, tipoIncidenteLabel } from '../labels';
import { getIncidenteById } from '../queries';
import { HistorialTimeline } from './HistorialTimeline';
import { IncidenteDetailHeader } from './IncidenteDetailHeader';

/**
 * T-063 · Detalle de un incidente (read-only) + historial de correcciones.
 *
 * Cards condicionales (calca el detail de clientes): una sección sin datos no
 * se renderiza. Las acciones Corregir/Anular sólo se ofrecen sobre el registro
 * vigente (`esVigente`); para versiones históricas mostramos un aviso.
 */
export default async function IncidenteDetallePage({
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
  const { incidente, historial, esVigente } = result;

  const cliente = incidente.cliente_id
    ? await getClienteById(supabase, incidente.cliente_id)
    : null;
  const empleado = incidente.empleado_id
    ? await getEmpleadoById(supabase, incidente.empleado_id)
    : null;

  const isAccidente = incidente.tipo === 'accidente';
  const hasContexto = !!(cliente || empleado || incidente.lugar_especifico);

  return (
    <div className="max-w-4xl space-y-6">
      <IncidenteDetailHeader incidente={incidente} esVigente={esVigente} />

      {!esVigente && (
        <Card>
          <CardContent className="text-muted-foreground py-4 text-sm">
            Este registro fue corregido o anulado. Estás viendo una versión histórica del libro; las
            acciones no están disponibles.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Clasificación</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
          <Field label="Tipo" value={tipoIncidenteLabel(incidente.tipo)} />
          <Field label="Fecha" value={formatCivilDateLongAR(incidente.fecha)} />
          {incidente.hora && <Field label="Hora" value={incidente.hora.slice(0, 5)} />}
        </CardContent>
      </Card>

      {hasContexto && (
        <Card>
          <CardHeader>
            <CardTitle>Contexto</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
            {cliente && <Field label="Cliente (dónde ocurrió)" value={cliente.razon_social} />}
            {empleado && (
              <Field
                label="Empleado (víctima)"
                value={`${empleado.apellido}, ${empleado.nombre}${empleado.dni ? ` · DNI ${empleado.dni}` : ''}`}
              />
            )}
            {incidente.lugar_especifico && (
              <Field
                label="Lugar específico"
                value={incidente.lugar_especifico}
                className="md:col-span-2"
              />
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Descripción</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <p className="text-muted-foreground text-xs tracking-wide uppercase">¿Qué pasó?</p>
            <p className="whitespace-pre-wrap">{incidente.descripcion}</p>
          </div>
          {incidente.causa_raiz && (
            <div>
              <p className="text-muted-foreground text-xs tracking-wide uppercase">Causa raíz</p>
              <p className="whitespace-pre-wrap">{incidente.causa_raiz}</p>
            </div>
          )}
          {incidente.accion_inmediata && (
            <div>
              <p className="text-muted-foreground text-xs tracking-wide uppercase">
                Acción inmediata
              </p>
              <p className="whitespace-pre-wrap">{incidente.accion_inmediata}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {isAccidente && incidente.gravedad && (
        <Card>
          <CardHeader>
            <CardTitle>Lesión</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
            <Field label="Gravedad" value={gravedadIncidenteLabel(incidente.gravedad)} />
            {incidente.dias_perdidos != null && (
              <Field label="Días perdidos" value={String(incidente.dias_perdidos)} />
            )}
          </CardContent>
        </Card>
      )}

      {historial.length > 0 && <HistorialTimeline historial={historial} />}
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
