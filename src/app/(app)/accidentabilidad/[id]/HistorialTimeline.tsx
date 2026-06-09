import type { IncidenteRow } from '../queries';

import { Badge } from '@/shared/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

import {
  formatCivilDateShortAR,
  formatTimestampEs,
  gravedadIncidenteLabel,
  tipoIncidenteLabel,
} from '../labels';

/**
 * T-063-FU1 · Historial read-only de la cadena de correcciones (más nueva → más
 * vieja). Por cada versión previa muestra los campos clave y RESALTA los que
 * difieren respecto de la versión que la reemplazó (la inmediatamente más nueva).
 *
 * La cadena completa nuevo→viejo es `[vigente, ...historial]`: la versión previa
 * `historial[i]` se compara contra `versiones[i]` (su reemplazante) — para
 * `historial[0]` eso es el incidente vigente (mostrado arriba en el detalle).
 * El libro es append-only: nada acá se edita.
 */

type CampoKey = 'tipo' | 'fecha' | 'hora' | 'gravedad' | 'lugar_especifico';

const CAMPOS: { key: CampoKey; label: string; render: (r: IncidenteRow) => string }[] = [
  { key: 'tipo', label: 'Tipo', render: (r) => tipoIncidenteLabel(r.tipo) },
  { key: 'fecha', label: 'Fecha', render: (r) => formatCivilDateShortAR(r.fecha) },
  { key: 'hora', label: 'Hora', render: (r) => (r.hora ? r.hora.slice(0, 5) : '—') },
  {
    key: 'gravedad',
    label: 'Gravedad',
    render: (r) => (r.gravedad ? gravedadIncidenteLabel(r.gravedad) : '—'),
  },
  { key: 'lugar_especifico', label: 'Lugar', render: (r) => r.lugar_especifico ?? '—' },
];

function ChipCambio() {
  return (
    <Badge variant="outline" className="px-1 py-0 text-[10px] leading-tight">
      cambió
    </Badge>
  );
}

export function HistorialTimeline({
  vigente,
  historial,
}: {
  vigente: IncidenteRow;
  historial: IncidenteRow[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Historial de correcciones</CardTitle>
        <CardDescription>
          {historial.length === 1
            ? '1 versión previa de este registro — se resaltan los campos que cambiaron.'
            : `${historial.length} versiones previas de este registro — se resaltan los campos que cambiaron.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="border-muted space-y-6 border-l pl-4">
          {historial.map((h, i) => {
            // Reemplazante = versión inmediatamente más nueva. Para la primera
            // entrada del historial, es el incidente vigente.
            const newer = i === 0 ? vigente : historial[i - 1]!;
            const changed = (key: CampoKey) => h[key] !== newer[key];
            const descripcionChanged = h.descripcion !== newer.descripcion;

            return (
              <li key={h.id} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={h.anulacion ? 'outline' : 'secondary'}>
                    {h.anulacion ? 'Anulación' : 'Versión previa'}
                  </Badge>
                  <time className="text-muted-foreground text-xs" dateTime={h.created_at}>
                    {formatTimestampEs(h.created_at)}
                  </time>
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                  {CAMPOS.map((campo) => {
                    const isChanged = changed(campo.key);
                    return (
                      <div key={campo.key} className="space-y-0.5">
                        <dt className="text-muted-foreground flex items-center gap-1 text-xs tracking-wide uppercase">
                          {campo.label}
                          {isChanged && <ChipCambio />}
                        </dt>
                        <dd
                          className={
                            isChanged ? 'text-foreground font-semibold' : 'text-muted-foreground'
                          }
                        >
                          {campo.render(h)}
                        </dd>
                      </div>
                    );
                  })}
                </dl>

                <div className="space-y-0.5 text-sm">
                  <p className="text-muted-foreground flex items-center gap-1 text-xs tracking-wide uppercase">
                    Descripción
                    {descripcionChanged && <ChipCambio />}
                  </p>
                  <p
                    className={`whitespace-pre-wrap ${
                      descripcionChanged ? 'text-foreground font-medium' : 'text-muted-foreground'
                    }`}
                  >
                    {h.descripcion}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
