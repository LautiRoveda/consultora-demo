import type { EntregaDetail, PlanificacionWithEvent } from './queries';
import Link from 'next/link';

import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

const MOTIVO_LABELS: Record<string, string> = {
  inicial: 'Inicial',
  renovacion: 'Renovación',
  reposicion_rotura: 'Reposición — rotura',
  reposicion_perdida: 'Reposición — pérdida',
  rotacion: 'Rotación',
};

const dateFormatter = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export type EntregaDetailViewProps = {
  entrega: EntregaDetail;
  firmaUrl: string | null;
  planificaciones: PlanificacionWithEvent[];
};

export function EntregaDetailView({ entrega, firmaUrl, planificaciones }: EntregaDetailViewProps) {
  const firmada = entrega.firmado_at !== null;

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href="/epp/entregas">← Volver a entregas</Link>
        </Button>
        <Badge variant={firmada ? 'default' : 'secondary'}>
          {firmada ? 'Firmada' : 'Pendiente'}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Entrega EPP del {dateFormatter.format(new Date(entrega.fecha_entrega))}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Empleado</div>
            <div className="font-medium">
              {entrega.empleado?.apellido}, {entrega.empleado?.nombre}
            </div>
            {entrega.empleado?.dni && (
              <div className="text-sm text-muted-foreground">DNI {entrega.empleado.dni}</div>
            )}
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Cliente</div>
            <div className="font-medium">{entrega.cliente?.razon_social ?? '—'}</div>
          </div>
          {entrega.firmado_at && (
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Firmado el
              </div>
              <div>{dateTimeFormatter.format(new Date(entrega.firmado_at))}</div>
            </div>
          )}
          {entrega.observaciones && (
            <div className="sm:col-span-2">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Observaciones
              </div>
              <p className="text-sm">{entrega.observaciones}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Items entregados ({entrega.items.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">Item</th>
                  <th className="py-2 pr-3">Cantidad</th>
                  <th className="py-2 pr-3">Motivo</th>
                  <th className="py-2 pr-3">N° serie</th>
                  <th className="py-2 pr-3">Marca / Modelo</th>
                </tr>
              </thead>
              <tbody>
                {entrega.items.map((it) => (
                  <tr key={it.id} className="border-t">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{it.item_nombre}</div>
                      {it.item_es_descartable && (
                        <Badge variant="outline" className="mt-1 text-[10px]">
                          Descartable
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 pr-3">{it.cantidad}</td>
                    <td className="py-2 pr-3">
                      {MOTIVO_LABELS[it.motivo_entrega] ?? it.motivo_entrega}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{it.numero_serie ?? '—'}</td>
                    <td className="py-2 pr-3">
                      {[it.marca_entregada, it.modelo_entregado].filter(Boolean).join(' · ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Firma del operario</CardTitle>
        </CardHeader>
        <CardContent>
          {firmaUrl ? (
            <div className="h-40 w-full max-w-md overflow-hidden rounded-md border bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element -- Signed URL externa con TTL; usar <img> directo para evitar remotePatterns config (consistente con AttachmentsSection lightbox). */}
              <img
                src={firmaUrl}
                alt="Firma del operario"
                className="h-full w-full object-contain"
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Sin firma adjunta. Esta entrega aún no fue cerrada.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Planificación generada ({planificaciones.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {planificaciones.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin planificaciones generadas. Los items descartables no generan recordatorio.
            </p>
          ) : (
            <ul className="grid gap-2">
              {planificaciones.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 p-3 text-sm"
                >
                  <div>
                    <div className="font-medium">{p.item_nombre ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">
                      Próxima entrega:{' '}
                      {p.calendar_event_fecha_vencimiento
                        ? dateFormatter.format(new Date(p.calendar_event_fecha_vencimiento))
                        : dateFormatter.format(new Date(p.fecha_proxima_entrega))}
                      {' · '}
                      {p.frecuencia_meses} meses
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {p.estado}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
