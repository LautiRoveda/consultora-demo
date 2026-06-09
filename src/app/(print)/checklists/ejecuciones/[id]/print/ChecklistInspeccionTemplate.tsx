import type {
  ChecklistExecutionRow,
  EjecucionFirma,
  EjecucionSectionNode,
} from '@/app/(app)/checklists/ejecuciones/queries';
import type { Database } from '@/shared/supabase/types';

import { formatCivilDateAR, formatDateTimeAR } from '@/shared/lib/format-date';

type ExecutionRespuestaRow = Database['public']['Tables']['execution_respuestas']['Row'];
type TemplateItemRow = Database['public']['Tables']['template_items']['Row'];

/**
 * T-060b · Template imprimible del Relevamiento RGRL (Res SRT 463/09).
 *
 * Server Component puro (sin I/O). CSS inline obligatorio: Puppeteer renderea via
 * setContent en about:blank, las stylesheets externas de Tailwind no resuelven.
 * Molde: EppPlanillaTemplate (T-104). El snapshot del establecimiento + el score
 * + la firma vienen congelados de la ejecución cerrada.
 */

export type ChecklistInspeccionTemplateProps = {
  execution: ChecklistExecutionRow;
  sections: EjecucionSectionNode[];
  respuestasByItemId: Record<string, ExecutionRespuestaRow>;
  adjuntosByRespuesta: Record<string, string[]>;
  firma: EjecucionFirma | null;
  firmaSignedUrl: string | null;
  logoSignedUrl: string | null;
  consultoraName: string;
  generatedAt: string;
};

function joinEstablecimientoDir(e: ChecklistExecutionRow): string {
  const parts = [
    e.establecimiento_domicilio,
    e.establecimiento_localidad,
    e.establecimiento_provincia,
  ].filter((p): p is string => Boolean(p && p.trim().length > 0));
  return parts.length > 0 ? parts.join(', ') : '—';
}

function isNoCumpleRow(item: TemplateItemRow, resp: ExecutionRespuestaRow | undefined): boolean {
  return item.response_type === 'cumple_no_aplica' && resp?.valor === 'no';
}

/** Etiqueta de la respuesta según response_type. */
function responseLabel(item: TemplateItemRow, resp: ExecutionRespuestaRow | undefined): string {
  if (!resp) return '—';
  switch (item.response_type) {
    case 'cumple_no_aplica':
      return resp.valor === 'si'
        ? 'CUMPLE'
        : resp.valor === 'no'
          ? 'NO CUMPLE'
          : resp.valor === 'na'
            ? 'N/A'
            : '—';
    case 'si_no':
      return resp.valor === 'si' ? 'Sí' : resp.valor === 'no' ? 'No' : '—';
    case 'numerico':
      return resp.valor_numerico != null ? String(resp.valor_numerico) : '—';
    case 'texto':
      return resp.valor && resp.valor.trim().length > 0 ? resp.valor : '—';
    default:
      return '—';
  }
}

function responseClass(item: TemplateItemRow, resp: ExecutionRespuestaRow | undefined): string {
  if (item.response_type !== 'cumple_no_aplica') return 'resp-info';
  if (resp?.valor === 'si') return 'resp-ok';
  if (resp?.valor === 'no') return 'resp-bad';
  if (resp?.valor === 'na') return 'resp-na';
  return '';
}

export function ChecklistInspeccionTemplate({
  execution,
  sections,
  respuestasByItemId,
  adjuntosByRespuesta,
  firma,
  firmaSignedUrl,
  logoSignedUrl,
  consultoraName,
  generatedAt,
}: ChecklistInspeccionTemplateProps) {
  const idShort = execution.id.slice(0, 8);
  const fechaInspeccion = execution.fecha_inspeccion
    ? formatCivilDateAR(execution.fecha_inspeccion)
    : '—';
  const cerradaAt = execution.cerrada_at ? formatDateTimeAR(execution.cerrada_at) : '—';
  const firmadoAt = firma?.firmado_at ? formatDateTimeAR(firma.firmado_at) : '—';
  const pct = execution.cumplimiento_pct;

  return (
    <>
      <style>{`
        @page { size: A4; margin: 18mm 16mm 22mm 16mm; }
        body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; font-size: 10pt; line-height: 1.4; color: #18181b; }
        .pdf-root { padding: 0; }

        .pdf-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16pt; border-bottom: 2px solid #18181b; padding-bottom: 10pt; margin-bottom: 12pt; }
        .pdf-header-logo { max-height: 56pt; max-width: 200pt; object-fit: contain; display: block; margin-bottom: 6pt; }
        .pdf-header-consultora { font-size: 12pt; font-weight: 600; }
        .pdf-header-title { text-align: right; }
        .pdf-header-title h1 { font-size: 13pt; font-weight: 700; margin: 0; line-height: 1.2; }
        .pdf-header-title small { display: block; font-size: 8.5pt; color: #52525b; margin-top: 2pt; }

        .pdf-section { margin-top: 10pt; }
        .pdf-section-title { font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #52525b; margin: 0 0 5pt; padding-bottom: 3pt; border-bottom: 1px solid #d4d4d8; }
        .pdf-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 3pt 16pt; margin: 0; }
        .pdf-field { display: flex; gap: 6pt; align-items: baseline; }
        .pdf-field dt { font-size: 8.5pt; color: #71717a; text-transform: uppercase; letter-spacing: 0.04em; margin: 0; min-width: 78pt; }
        .pdf-field dd { font-size: 10pt; font-weight: 500; margin: 0; flex: 1; }

        .pdf-score { display: flex; gap: 16pt; align-items: center; margin-top: 6pt; padding: 8pt 12pt; border: 1px solid #d4d4d8; border-radius: 4pt; background: #fafafa; }
        .pdf-score-pct { font-size: 20pt; font-weight: 700; }
        .pdf-score-detail { font-size: 9pt; color: #3f3f46; }
        .pdf-badge-critico { display: inline-block; margin-left: auto; padding: 3pt 8pt; border-radius: 99pt; background: #fee2e2; color: #991b1b; font-size: 8.5pt; font-weight: 700; text-transform: uppercase; }

        .pdf-sec-block { margin-top: 12pt; page-break-inside: auto; }
        .pdf-sec-block h2 { font-size: 11pt; font-weight: 700; margin: 0 0 4pt; padding: 4pt 6pt; background: #f4f4f5; border-left: 3px solid #18181b; }
        .pdf-items-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
        .pdf-items-table th, .pdf-items-table td { border: 1px solid #d4d4d8; padding: 4pt 6pt; text-align: left; vertical-align: top; }
        .pdf-items-table th { background: #f4f4f5; font-weight: 600; text-transform: uppercase; font-size: 7.5pt; letter-spacing: 0.04em; color: #3f3f46; }
        .pdf-items-table tr { page-break-inside: avoid; }
        .col-num { width: 18pt; text-align: center; color: #71717a; }
        .col-resp { width: 70pt; text-align: center; font-weight: 700; white-space: nowrap; }
        .col-reg { width: 80pt; }
        .resp-ok { color: #166534; }
        .resp-bad { color: #991b1b; }
        .resp-na { color: #71717a; }
        .resp-info { color: #18181b; font-weight: 500; }
        .row-bad { background: #fef2f2; }
        .item-normativa { display: block; font-size: 7.5pt; color: #52525b; margin-top: 2pt; }
        .item-obs { display: block; font-size: 8pt; color: #3f3f46; font-style: italic; margin-top: 2pt; }
        .reg-fecha { font-weight: 700; color: #991b1b; }
        .item-fotos { margin-top: 4pt; display: flex; gap: 4pt; flex-wrap: wrap; }
        .item-fotos img { max-height: 70pt; max-width: 100pt; object-fit: cover; border: 1px solid #d4d4d8; border-radius: 2pt; }

        .pdf-firmas { margin-top: 16pt; display: grid; grid-template-columns: 1fr 1fr; gap: 24pt; page-break-inside: avoid; }
        .pdf-firma-block { padding-top: 8pt; }
        .pdf-firma-img { width: 100%; max-height: 80pt; object-fit: contain; display: block; margin: 0 auto 4pt; border-bottom: 1px solid #71717a; padding-bottom: 4pt; }
        .pdf-firma-line { border-bottom: 1px solid #18181b; height: 64pt; margin-bottom: 4pt; }
        .pdf-firma-caption { font-size: 8.5pt; color: #52525b; text-align: center; }
        .pdf-firma-caption strong { display: block; font-size: 9.5pt; color: #18181b; font-weight: 600; margin-bottom: 1pt; }

        .pdf-footer { margin-top: 16pt; padding-top: 8pt; border-top: 1px solid #d4d4d8; font-size: 8pt; color: #71717a; display: flex; justify-content: space-between; gap: 12pt; }

        @media print {
          .pdf-items-table thead { display: table-header-group; }
          .pdf-firmas { page-break-inside: avoid; }
        }
      `}</style>

      <div className="pdf-root">
        <header className="pdf-header">
          <div>
            {logoSignedUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- Signed URL externa, sin Next/Image en Puppeteer.
              <img src={logoSignedUrl} alt={consultoraName} className="pdf-header-logo" />
            ) : null}
            <div className="pdf-header-consultora">{consultoraName}</div>
          </div>
          <div className="pdf-header-title">
            <h1>Relevamiento General de Riesgos Laborales</h1>
            <small>Resolución SRT N° 463/09 — Decreto 351/79</small>
            <small>Inspección {idShort}</small>
          </div>
        </header>

        <section className="pdf-section">
          <h2 className="pdf-section-title">Establecimiento</h2>
          <dl className="pdf-grid-2">
            <div className="pdf-field">
              <dt>Razón social</dt>
              <dd>{execution.establecimiento_razon_social ?? '—'}</dd>
            </div>
            <div className="pdf-field">
              <dt>CUIT</dt>
              <dd>{execution.establecimiento_cuit ?? '—'}</dd>
            </div>
            <div className="pdf-field">
              <dt>Domicilio</dt>
              <dd>{joinEstablecimientoDir(execution)}</dd>
            </div>
            <div className="pdf-field">
              <dt>Fecha inspección</dt>
              <dd>{fechaInspeccion}</dd>
            </div>
          </dl>

          <div className="pdf-score">
            <div>
              <div className="pdf-score-pct">{pct != null ? `${pct}%` : '—'}</div>
              <div className="pdf-score-detail">Cumplimiento</div>
            </div>
            <div className="pdf-score-detail">
              Cumple: <strong>{execution.score_cumple ?? 0}</strong> · No cumple:{' '}
              <strong>{execution.score_no_cumple ?? 0}</strong> · N/A:{' '}
              <strong>{execution.score_na ?? 0}</strong>
            </div>
            {execution.tiene_criticos_incumplidos ? (
              <span className="pdf-badge-critico">Críticos incumplidos</span>
            ) : null}
          </div>
        </section>

        {sections.map((section) => (
          <div key={section.id} className="pdf-sec-block">
            <h2>{section.titulo}</h2>
            <table className="pdf-items-table">
              <thead>
                <tr>
                  <th className="col-num">#</th>
                  <th>Ítem</th>
                  <th className="col-resp">Resultado</th>
                  <th className="col-reg">Regularización</th>
                </tr>
              </thead>
              <tbody>
                {section.items.map((item, idx) => {
                  const resp = respuestasByItemId[item.id];
                  const noCumple = isNoCumpleRow(item, resp);
                  const fotos = resp ? (adjuntosByRespuesta[resp.id] ?? []) : [];
                  return (
                    <tr key={item.id} className={noCumple ? 'row-bad' : undefined}>
                      <td className="col-num">{idx + 1}</td>
                      <td>
                        {item.texto}
                        {item.referencia_normativa ? (
                          <span className="item-normativa">{item.referencia_normativa}</span>
                        ) : null}
                        {resp?.observacion ? (
                          <span className="item-obs">Obs.: {resp.observacion}</span>
                        ) : null}
                        {fotos.length > 0 ? (
                          <span className="item-fotos">
                            {fotos.map((url, i) => (
                              // eslint-disable-next-line @next/next/no-img-element -- Signed URL externa, sin Next/Image en Puppeteer.
                              <img key={i} src={url} alt={`Evidencia ${idx + 1}.${i + 1}`} />
                            ))}
                          </span>
                        ) : null}
                      </td>
                      <td className={`col-resp ${responseClass(item, resp)}`}>
                        {responseLabel(item, resp)}
                      </td>
                      <td className="col-reg">
                        {noCumple && resp?.fecha_regularizacion ? (
                          <span className="reg-fecha">
                            {formatCivilDateAR(resp.fecha_regularizacion)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}

        <section className="pdf-firmas">
          <div className="pdf-firma-block">
            {firmaSignedUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- Signed URL externa con TTL; sin Next/Image en Puppeteer.
              <img src={firmaSignedUrl} alt="Firma del matriculado" className="pdf-firma-img" />
            ) : (
              <div className="pdf-firma-line" />
            )}
            <div className="pdf-firma-caption">
              <strong>Firma del profesional matriculado</strong>
              {firma?.firmante_nombre ?? '—'}
              {firma?.firmante_matricula ? ` — Mat. ${firma.firmante_matricula}` : ''}
              <div>Firmado el {firmadoAt}</div>
            </div>
          </div>

          <div className="pdf-firma-block">
            <div className="pdf-firma-line" />
            <div className="pdf-firma-caption">
              <strong>Firma y aclaración del establecimiento</strong>
              (Notificado de los hallazgos y plazos de regularización)
            </div>
          </div>
        </section>

        <footer className="pdf-footer">
          <span>
            Inspección {idShort} · Cerrada el {cerradaAt}
          </span>
          <span>Generado el {formatDateTimeAR(generatedAt)}</span>
        </footer>
      </div>
    </>
  );
}
