import type {
  EntregaTimelineEntry,
  EntregaTimelineItemDetail,
  PlanificacionActivaEmpleado,
} from '@/app/(app)/epp/entregas/queries';

import { formatDateAR } from '@/shared/lib/format-date';
import { Badge } from '@/shared/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

// Etiquetas legibles del enum motivo_entrega_epp (schema T-100). El Record
// fuerza exhaustividad: agregar un valor al enum sin etiqueta rompe el typecheck.
const MOTIVO_LABEL: Record<EntregaTimelineItemDetail['motivo_entrega'], string> = {
  inicial: 'Inicial',
  renovacion: 'Renovación',
  reposicion_rotura: 'Reposición (rotura)',
  reposicion_perdida: 'Reposición (pérdida)',
  rotacion: 'Rotación',
};

interface Props {
  entregas: EntregaTimelineEntry[];
  planificaciones: PlanificacionActivaEmpleado[];
  // `now` inyectable para test/determinismo; default al momento de render.
  now?: Date;
}

/**
 * T-109 · Sección "Entregas EPP" en el detail del empleado. Timeline
 * cronológica de entregas firmadas (Res SRT 299/11) + próximos vencimientos
 * desde epp_planificaciones. Server component sin estado: la data llega por
 * props desde page.tsx (mismo patrón que PuestosCard).
 *
 * Siempre se renderiza con empty state propio (no es una Card condicional por
 * presencia de data — la sección es parte del núcleo de la ficha, como Puestos).
 * Fechas via helper format-date (TZ AR), nunca toISOString.
 */
export function EntregasEppCard({ entregas, planificaciones, now = new Date() }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Entregas EPP</CardTitle>
        <CardDescription>
          Historial cronológico de elementos de protección entregados y próximos vencimientos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-3">
          {entregas.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Sin entregas de EPP registradas todavía. Registrá una desde el módulo EPP.
            </p>
          ) : (
            <ul className="space-y-3">
              {entregas.map((e) => (
                <li key={e.id} className="rounded-md border p-3">
                  <div className="font-medium">{formatDateAR(e.fecha_entrega)}</div>
                  <ul className="mt-2 space-y-1.5">
                    {e.items.map((it) => (
                      <li key={it.id} className="flex flex-wrap items-center gap-2 text-sm">
                        <span>{it.item_nombre}</span>
                        <Badge variant="outline">{it.categoria_nombre}</Badge>
                        {it.cantidad > 1 && (
                          <span className="text-muted-foreground text-xs">×{it.cantidad}</span>
                        )}
                        <Badge variant="secondary">{MOTIVO_LABEL[it.motivo_entrega]}</Badge>
                        {it.numero_serie && (
                          <span className="text-muted-foreground text-xs">
                            S/N {it.numero_serie}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {e.observaciones && (
                    <p className="text-muted-foreground mt-2 text-sm whitespace-pre-wrap">
                      {e.observaciones}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {planificaciones.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-medium">Próximos vencimientos</h3>
            <ul className="space-y-2">
              {planificaciones.map((p) => {
                const overdue = new Date(p.fecha_proxima_entrega) < now;
                return (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 p-2.5 text-sm"
                  >
                    <span>{p.item_nombre}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        {formatDateAR(p.fecha_proxima_entrega)}
                      </span>
                      {overdue && <Badge variant="destructive">Vencido</Badge>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
