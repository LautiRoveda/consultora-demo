import { AlertTriangle, Download } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getClientesForConsultora } from '@/app/(app)/clientes/queries';
import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { formatCivilDateAR } from '@/shared/lib/format-date';
import { createClient } from '@/shared/supabase/server';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

import { ClienteSelect } from '../ClienteSelect';
import { TIPO_LABELS, TIPO_ORDER } from '../labels';
import { listExpuestosByCliente } from '../queries';
import { RarTabsNav } from '../RarTabsNav';

type SearchParams = { cliente?: string };

export const metadata = { title: 'Planilla · RAR' };

export default async function RarPlanillaPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) redirect('/dashboard');

  const clientes = await getClientesForConsultora(supabase);
  const selected = clientes.find((c) => c.id === sp.cliente);
  const nomina = selected ? await listExpuestosByCliente(supabase, selected.id) : null;

  const faltantes = nomina?.expuestos.filter((e) => e.faltan_datos) ?? [];
  const gruposDar = nomina
    ? TIPO_ORDER.map((tipo) => ({
        tipo,
        items: nomina.agentes.filter((a) => a.agente_tipo === tipo),
      })).filter((g) => g.items.length > 0)
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Planilla RAR</h1>
        <p className="text-muted-foreground text-sm">
          Generá la planilla del Relevamiento de Agentes de Riesgo (Res SRT 37/2010) por
          establecimiento. La nómina de expuestos se deriva de la exposición declarada por puesto —
          cada empleado hereda los agentes de sus puestos.
        </p>
      </div>

      <RarTabsNav activeKey="planilla" />

      {clientes.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          No tenés clientes cargados. Creá un cliente en{' '}
          <Link href="/clientes" className="underline">
            el módulo de clientes
          </Link>{' '}
          antes de generar la planilla.
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <p className="text-sm font-medium">Cliente / establecimiento</p>
            <ClienteSelect clientes={clientes} selectedId={selected?.id} />
          </div>

          {!selected ? (
            <p className="text-muted-foreground text-sm">
              Elegí un cliente para ver la nómina de trabajadores expuestos y descargar la planilla.
            </p>
          ) : (
            nomina && (
              <div className="space-y-4">
                {faltantes.length > 0 && (
                  <div className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                    <AlertTriangle
                      className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
                      aria-hidden="true"
                    />
                    <div className="space-y-1">
                      <p className="font-medium">
                        {faltantes.length} trabajador{faltantes.length === 1 ? '' : 'es'} con datos
                        incompletos (CUIL o fecha de ingreso).
                      </p>
                      <p className="text-amber-800">
                        La planilla se genera igual con &quot;—&quot; en los campos faltantes.
                        Completalos para una presentación válida:
                      </p>
                      <ul className="list-inside list-disc">
                        {faltantes.map((e) => (
                          <li key={e.empleado_id}>
                            <Link
                              href={`/empleados/${e.empleado_id}/editar`}
                              className="underline underline-offset-2"
                            >
                              {e.apellido}, {e.nombre}
                            </Link>{' '}
                            — falta {!e.cuil ? 'CUIL' : ''}
                            {!e.cuil && !e.fecha_ingreso ? ' y ' : ''}
                            {!e.fecha_ingreso ? 'fecha de ingreso' : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-muted-foreground text-sm">
                    {nomina.expuestos.length === 0
                      ? 'Sin personal expuesto a agentes de riesgo. La planilla se genera igual declarando la ausencia de exposición.'
                      : `${nomina.expuestos.length} trabajador${
                          nomina.expuestos.length === 1 ? '' : 'es'
                        } expuesto${nomina.expuestos.length === 1 ? '' : 's'} · ${
                          nomina.agentes.length
                        } agente${nomina.agentes.length === 1 ? '' : 's'} de riesgo.`}
                  </p>
                  <Button asChild variant="outline" size="sm">
                    <a href={`/api/rar/planilla/${selected.id}/pdf`} download>
                      <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                      Descargar planilla RAR
                    </a>
                  </Button>
                </div>

                {gruposDar.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Agentes del establecimiento</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      {gruposDar.map((g) => (
                        <div key={g.tipo}>
                          <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                            {TIPO_LABELS[g.tipo]}
                          </p>
                          <ul className="mt-1 space-y-0.5">
                            {g.items.map((a) => (
                              <li key={a.agente_id}>
                                <span className="font-mono text-xs font-semibold">{a.codigo}</span>{' '}
                                {a.nombre}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {nomina.expuestos.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Trabajadores expuestos</CardTitle>
                    </CardHeader>
                    <CardContent className="px-0 pb-0">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="text-muted-foreground border-b text-left text-xs uppercase">
                            <tr>
                              <th className="px-4 py-2 font-medium">Apellido y nombre</th>
                              <th className="px-4 py-2 font-medium">CUIL</th>
                              <th className="px-4 py-2 font-medium">Puesto(s)</th>
                              <th className="px-4 py-2 font-medium">Ingreso</th>
                              <th className="px-4 py-2 font-medium">Agentes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {nomina.expuestos.map((e) => (
                              <tr key={e.empleado_id} className="border-b last:border-0">
                                <td className="px-4 py-2">
                                  {e.apellido}, {e.nombre}
                                </td>
                                <td className="px-4 py-2 font-mono text-xs">{e.cuil ?? '—'}</td>
                                <td className="px-4 py-2">
                                  {e.puestos.length > 0 ? e.puestos.join(', ') : '—'}
                                </td>
                                <td className="px-4 py-2">
                                  {e.fecha_ingreso ? formatCivilDateAR(e.fecha_ingreso) : '—'}
                                </td>
                                <td className="px-4 py-2 font-mono text-xs">
                                  {e.agentes.map((a) => a.codigo).join(', ')}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
