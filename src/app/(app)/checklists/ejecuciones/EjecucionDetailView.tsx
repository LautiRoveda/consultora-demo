import type {
  CapaForDetail,
  ChecklistExecutionRow,
  EjecucionFirma,
  EjecucionSectionNode,
  ExecutionRespuestaRow,
  TemplateItemRow,
} from './queries';
import { Download } from 'lucide-react';
import Link from 'next/link';

import { formatCivilDateAR, formatDateTimeAR } from '@/shared/lib/format-date';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

import { EjecucionDetailActions } from './EjecucionDetailActions';
import { EjecucionEstadoBadge } from './EjecucionEstadoBadge';

const PRIORIDAD_LABELS: Record<string, string> = { alta: 'Alta', media: 'Media', baja: 'Baja' };
const CAPA_ESTADO_LABELS: Record<string, string> = {
  pendiente: 'Pendiente',
  en_curso: 'En curso',
  cerrada: 'Cerrada',
  anulada: 'Anulada',
};

export type EjecucionDetailViewProps = {
  execution: ChecklistExecutionRow;
  sections: EjecucionSectionNode[];
  respuestasByItemId: Record<string, ExecutionRespuestaRow>;
  /** respuesta_id → signed URLs de las fotos. */
  adjuntosByRespuesta: Record<string, string[]>;
  firma: EjecucionFirma | null;
  firmaUrl: string | null;
  acciones: CapaForDetail[];
  /** false = anulada/superseded → read-only, sin PDF ni anular. */
  esVigente: boolean;
  isOwner: boolean;
};

/** Texto + flag "no cumple" de una respuesta según su tipo (espeja scoring.ts). */
function formatRespuesta(
  item: TemplateItemRow,
  resp: ExecutionRespuestaRow | undefined,
): { label: string; isNoCumple: boolean } {
  if (!resp) return { label: 'Sin responder', isNoCumple: false };
  switch (item.response_type) {
    case 'cumple_no_aplica':
      if (resp.valor === 'si') return { label: 'Cumple', isNoCumple: false };
      if (resp.valor === 'no') return { label: 'No cumple', isNoCumple: true };
      if (resp.valor === 'na') return { label: 'No aplica', isNoCumple: false };
      return { label: 'Sin responder', isNoCumple: false };
    case 'si_no':
      return {
        label: resp.valor === 'si' ? 'Sí' : resp.valor === 'no' ? 'No' : 'Sin responder',
        isNoCumple: false,
      };
    case 'texto':
      return { label: resp.valor?.trim() || 'Sin responder', isNoCumple: false };
    case 'numerico':
      return {
        label: resp.valor_numerico != null ? String(resp.valor_numerico) : 'Sin responder',
        isNoCumple: false,
      };
    default:
      return { label: 'Sin responder', isNoCumple: false };
  }
}

/** Deep-link al evento de calendario de una CAPA (necesita ?month= para la ventana). */
function capaCalendarHref(capa: CapaForDetail): string | null {
  if (!capa.calendar_event_id) return null;
  const month = (capa.calendar_event_fecha_vencimiento ?? capa.fecha_compromiso).slice(0, 7);
  return `/calendario?event=${capa.calendar_event_id}&month=${month}`;
}

/**
 * T-061b · Detalle completo de una inspección cerrada (reemplaza el placeholder):
 * score, hallazgos + fotos, CAPAs con deep-link al calendario, snapshot del
 * establecimiento, firma del matriculado, Descargar PDF y Anular. Si la inspección
 * fue anulada (`!esVigente`) el detalle es read-only con banner y sin PDF/anular.
 */
export function EjecucionDetailView({
  execution,
  sections,
  respuestasByItemId,
  adjuntosByRespuesta,
  firma,
  firmaUrl,
  acciones,
  esVigente,
  isOwner,
}: EjecucionDetailViewProps) {
  const cerrada = execution.estado === 'cerrada';
  const canDownloadPdf = esVigente && cerrada;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/checklists/ejecuciones">← Inspecciones</Link>
        </Button>
        <div className="flex items-center gap-2">
          {canDownloadPdf && (
            <Button asChild variant="outline" size="sm">
              <a href={`/api/checklists/ejecuciones/${execution.id}/pdf`} download>
                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                Descargar PDF
              </a>
            </Button>
          )}
          {esVigente && isOwner && <EjecucionDetailActions executionId={execution.id} />}
          <EjecucionEstadoBadge estado={esVigente ? execution.estado : 'anulada'} />
        </div>
      </div>

      {!esVigente && (
        <Card>
          <CardContent className="text-muted-foreground py-4 text-sm">
            Esta inspección fue anulada. Estás viendo el registro histórico para auditoría; no se
            puede presentar ni descargar el PDF.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{execution.establecimiento_razon_social ?? 'Inspección'}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {execution.fecha_inspeccion && (
            <p className="text-muted-foreground">
              Inspección del {formatCivilDateAR(execution.fecha_inspeccion)}
            </p>
          )}
          <p>
            Cumplimiento:{' '}
            <span className="font-medium">
              {execution.cumplimiento_pct != null
                ? `${execution.cumplimiento_pct}%`
                : 'No evaluable'}
            </span>
          </p>
          <p className="text-muted-foreground text-xs">
            Cumple {execution.score_cumple ?? 0} · No cumple {execution.score_no_cumple ?? 0} · No
            aplica {execution.score_na ?? 0}
          </p>
          {execution.tiene_criticos_incumplidos && (
            <p className="text-destructive">Tiene ítems críticos incumplidos.</p>
          )}
        </CardContent>
      </Card>

      {/* Hallazgos por sección. */}
      {sections.map((section) => (
        <Card key={section.id}>
          <CardHeader>
            <CardTitle className="text-base">{section.titulo}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {section.items.length === 0 ? (
              <p className="text-muted-foreground">Sin ítems.</p>
            ) : (
              section.items.map((item) => {
                const resp = respuestasByItemId[item.id];
                const { label, isNoCumple } = formatRespuesta(item, resp);
                const fotos = resp ? (adjuntosByRespuesta[resp.id] ?? []) : [];
                return (
                  <div key={item.id} className="grid gap-1 border-b pb-3 last:border-b-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <span className="break-words">
                        {item.texto}
                        {item.es_critico && (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            Crítico
                          </Badge>
                        )}
                      </span>
                      <span
                        className={`shrink-0 font-medium ${isNoCumple ? 'text-destructive' : ''}`}
                      >
                        {label}
                      </span>
                    </div>
                    {resp?.observacion && (
                      <p className="text-muted-foreground break-words text-xs">
                        {resp.observacion}
                      </p>
                    )}
                    {fotos.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-2">
                        {fotos.map((src, i) => (
                          // eslint-disable-next-line @next/next/no-img-element -- signed URL externa con TTL; <img> directo evita remotePatterns (consistente con EntregaDetailView).
                          <img
                            key={i}
                            src={src}
                            alt={`Evidencia de ${item.texto}`}
                            className="h-20 w-20 rounded-md border object-cover"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      ))}

      {/* CAPAs → calendario. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Acciones correctivas ({acciones.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {acciones.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Sin acciones correctivas (no hubo ítems «no cumple»).
            </p>
          ) : (
            <ul className="grid gap-2">
              {acciones.map((capa) => {
                const href = capaCalendarHref(capa);
                return (
                  <li
                    key={capa.id}
                    className="bg-muted/20 grid gap-1 rounded-md border p-3 text-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="break-words">{capa.descripcion}</span>
                      <Badge
                        variant={capa.prioridad === 'alta' ? 'destructive' : 'secondary'}
                        className="shrink-0 text-xs"
                      >
                        {PRIORIDAD_LABELS[capa.prioridad] ?? capa.prioridad}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 text-xs">
                      <span>Vence el {formatCivilDateAR(capa.fecha_compromiso)}</span>
                      <span>· {CAPA_ESTADO_LABELS[capa.estado] ?? capa.estado}</span>
                      {href && (
                        <Link href={href} className="hover:text-foreground underline">
                          Ver en el calendario
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Snapshot del establecimiento (congelado al cierre). */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Establecimiento</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
          <Field label="Razón social" value={execution.establecimiento_razon_social} />
          <Field label="CUIT" value={execution.establecimiento_cuit} />
          <Field label="Domicilio" value={execution.establecimiento_domicilio} />
          <Field label="Localidad" value={execution.establecimiento_localidad} />
          <Field label="Provincia" value={execution.establecimiento_provincia} />
        </CardContent>
      </Card>

      {/* Firma del matriculado. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Firma del matriculado</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {firmaUrl ? (
            <div className="h-40 w-full max-w-md overflow-hidden rounded-md border bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element -- signed URL externa con TTL; <img> directo evita remotePatterns (consistente con EntregaDetailView). */}
              <img
                src={firmaUrl}
                alt="Firma del matriculado"
                className="h-full w-full object-contain"
              />
            </div>
          ) : (
            <p className="text-muted-foreground">Sin firma adjunta.</p>
          )}
          {firma?.firmante_nombre && <Field label="Firmante" value={firma.firmante_nombre} />}
          {firma?.firmante_matricula && (
            <Field label="Matrícula" value={firma.firmante_matricula} />
          )}
          {firma?.firmado_at && (
            <Field label="Firmado el" value={formatDateTimeAR(firma.firmado_at)} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-muted-foreground text-xs tracking-wide uppercase">{label}</div>
      <div className="break-words">{value}</div>
    </div>
  );
}
