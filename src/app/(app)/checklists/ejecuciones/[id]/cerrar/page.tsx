import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

import { getClienteById } from '../../../../clientes/queries';
import { buildCapaRows } from '../../acciones-capa';
import { CerrarInspeccionForm } from '../../CerrarInspeccionForm';
import { getEjecucionBasics, getItemsForVersion, getRespuestasForExecution } from '../../queries';
import { computeScore, findUnansweredRequired, respuestasByItem } from '../../scoring';

/**
 * T-061b · Cierre con firma de una inspección. Owner-only: el member que entra
 * por URL vuelve al runner (`/[id]`). Re-lee score/faltantes FRESCO justo antes
 * de firmar (no confía en el snapshot del runner) y le pasa al form un preview
 * de cumplimiento + hallazgos "no cumple" + CAPAs a generar con sus fechas. El
 * `cerrarEjecucionAction` recomputa y valida todo server-side al cerrar.
 */
export default async function CerrarEjecucionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) redirect('/dashboard');

  // Owner-gate en el borde: el cierre con firma es del titular.
  if (consultora.role !== 'owner') redirect(`/checklists/ejecuciones/${id}`);

  const exec = await getEjecucionBasics(supabase, id);
  if (!exec) notFound();
  // Ya cerrada/anulada → al detalle (no se re-firma).
  if (exec.estado !== 'borrador') redirect(`/checklists/ejecuciones/${id}`);

  const backToRunner = (
    <Button asChild variant="ghost" size="sm">
      <Link href={`/checklists/ejecuciones/${id}`}>← Volver al relevamiento</Link>
    </Button>
  );

  if (!exec.cliente_id) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <div>{backToRunner}</div>
        <Card>
          <CardHeader>
            <CardTitle>Falta el cliente</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Asociá un cliente a la inspección antes de cerrarla. El establecimiento (razón social,
            CUIT, domicilio) se congela al firmar.
          </CardContent>
        </Card>
      </div>
    );
  }

  // Preview FRESCO (mismos helpers puros que usa el action al cerrar).
  const [items, respuestas, cliente] = await Promise.all([
    getItemsForVersion(supabase, exec.template_version_id),
    getRespuestasForExecution(supabase, id),
    getClienteById(supabase, exec.cliente_id),
  ]);
  const byItem = respuestasByItem(respuestas);
  const faltantes = findUnansweredRequired(items, byItem);
  const score = computeScore(items, byItem);
  // cerrada_at del preview (la fecha real la pone el action al cerrar).
  const capas = buildCapaRows(items, respuestas, new Date().toISOString());

  const clienteNombre = cliente?.razon_social ?? 'Inspección';

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>{backToRunner}</div>
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Cerrar y firmar inspección</h1>
        <p className="text-muted-foreground text-sm">{clienteNombre}</p>
      </header>

      {faltantes.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Faltan ítems obligatorios</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <p className="text-muted-foreground">
              No se puede cerrar hasta responder {faltantes.length} ítem(s) obligatorio(s):
            </p>
            <ul className="list-inside list-disc">
              {faltantes.map((f) => (
                <li key={f.id}>{f.texto}</li>
              ))}
            </ul>
            <Button asChild variant="outline">
              <Link href={`/checklists/ejecuciones/${id}`}>Volver a relevar</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <CerrarInspeccionForm
          executionId={id}
          fechaInspeccionDefault={exec.fecha_inspeccion ?? new Date().toISOString().slice(0, 10)}
          cumplimientoPct={score.cumplimiento_pct}
          tieneCriticos={score.tiene_criticos_incumplidos}
          capas={capas.map((c) => ({
            descripcion: c.descripcion,
            prioridad: c.prioridad,
            fecha_compromiso: c.fecha_compromiso,
          }))}
        />
      )}
    </div>
  );
}
