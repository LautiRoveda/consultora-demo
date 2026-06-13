import type { RarAgenteRef, RarPlanillaNomina } from '@/app/(app)/rar/queries';

import { TIPO_LABELS, TIPO_ORDER } from '@/app/(app)/rar/labels';
import { formatCivilDateAR, formatDateTimeAR } from '@/shared/lib/format-date';
import { RES_37_2010_DECLARACION } from '@/shared/templates/rar-planilla/declaracion-legal';

/**
 * T-144 · Template imprimible de la Planilla RAR (Res SRT 37/2010 + Dto 658/96).
 *
 * Server Component puro — sin I/O. Recibe los datos ya hidratados por el
 * `page.tsx` que envuelve. Render alineado a los requisitos de la DJ de agentes
 * de riesgo: identificación del empleador, Declaración de Agentes de Riesgo
 * (DAR) agrupada por tipo, Nómina de Trabajadores Expuestos (NTE) y firma
 * manuscrita del Responsable de HyS post-impresión.
 *
 * CSS inline obligatorio: Puppeteer renderea via setContent en about:blank, por
 * lo que los stylesheets externos de Tailwind no resuelven. Todo estilo visible
 * en el PDF va acá adentro de `<style>` (molde EppPlanillaTemplate).
 */

export type RarPlanillaCliente = {
  razon_social: string;
  cuit: string;
  domicilio: string | null;
  localidad: string | null;
  provincia: string | null;
  art: string | null;
};

export type RarPlanillaTemplateProps = {
  cliente: RarPlanillaCliente;
  nomina: RarPlanillaNomina;
  logoSignedUrl: string | null;
  consultoraName: string;
  generatedAt: string;
};

function joinAddress(cliente: RarPlanillaCliente): string {
  const parts = [cliente.domicilio, cliente.localidad, cliente.provincia].filter((p): p is string =>
    Boolean(p && p.trim().length > 0),
  );
  return parts.length > 0 ? parts.join(', ') : '—';
}

function agentesByTipo(
  agentes: RarAgenteRef[],
): { tipo: (typeof TIPO_ORDER)[number]; items: RarAgenteRef[] }[] {
  return TIPO_ORDER.map((tipo) => ({
    tipo,
    items: agentes.filter((a) => a.agente_tipo === tipo),
  })).filter((g) => g.items.length > 0);
}

export function RarPlanillaTemplate({
  cliente,
  nomina,
  logoSignedUrl,
  consultoraName,
  generatedAt,
}: RarPlanillaTemplateProps) {
  const periodo = new Date(generatedAt).getUTCFullYear();
  const generatedAtFormatted = formatDateTimeAR(generatedAt);
  const grupos = agentesByTipo(nomina.agentes);
  const hayExpuestos = nomina.expuestos.length > 0;

  return (
    <>
      <style>{`
        @page { size: A4; margin: 18mm 16mm 22mm 16mm; }
        body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; font-size: 10.5pt; line-height: 1.45; color: #18181b; }
        .pdf-root { padding: 0; }

        .pdf-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16pt; border-bottom: 2px solid #18181b; padding-bottom: 10pt; margin-bottom: 14pt; }
        .pdf-header-brand { flex: 1; }
        .pdf-header-logo { max-height: 56pt; max-width: 200pt; object-fit: contain; display: block; margin-bottom: 6pt; }
        .pdf-header-consultora { font-size: 12pt; font-weight: 600; color: #18181b; }
        .pdf-header-title { text-align: right; }
        .pdf-header-title h1 { font-size: 14pt; font-weight: 700; margin: 0; color: #09090b; line-height: 1.2; }
        .pdf-header-title small { display: block; font-size: 9pt; color: #52525b; margin-top: 2pt; }

        .pdf-section { margin-top: 10pt; }
        .pdf-section-title { font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #52525b; margin: 0 0 5pt; padding-bottom: 3pt; border-bottom: 1px solid #d4d4d8; }
        .pdf-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4pt 16pt; margin: 0; }
        .pdf-field { display: flex; gap: 6pt; align-items: baseline; }
        .pdf-field dt { font-size: 8.5pt; color: #71717a; text-transform: uppercase; letter-spacing: 0.04em; margin: 0; min-width: 70pt; }
        .pdf-field dd { font-size: 10pt; font-weight: 500; color: #18181b; margin: 0; flex: 1; }

        .pdf-dar-grupo { margin-top: 6pt; }
        .pdf-dar-grupo-tipo { font-size: 9pt; font-weight: 700; color: #3f3f46; margin: 0 0 2pt; }
        .pdf-dar-list { margin: 0; padding-left: 0; list-style: none; }
        .pdf-dar-list li { font-size: 9.5pt; color: #18181b; padding: 1pt 0; }
        .pdf-dar-codigo { font-family: ui-monospace, monospace; font-weight: 600; font-size: 9pt; margin-right: 6pt; }
        .pdf-dar-vacio { font-size: 9.5pt; color: #71717a; font-style: italic; }

        .pdf-items-table { width: 100%; border-collapse: collapse; margin-top: 6pt; font-size: 9pt; }
        .pdf-items-table th, .pdf-items-table td { border: 1px solid #d4d4d8; padding: 4pt 6pt; text-align: left; vertical-align: top; }
        .pdf-items-table th { background: #f4f4f5; font-weight: 600; text-transform: uppercase; font-size: 8pt; letter-spacing: 0.04em; color: #3f3f46; }
        .pdf-items-table td.col-cuil { font-family: ui-monospace, monospace; font-size: 8.5pt; }
        .pdf-items-table td.col-agentes { font-family: ui-monospace, monospace; font-size: 8.5pt; }

        .pdf-sin-expuestos { margin-top: 6pt; padding: 12pt; border: 1px dashed #a1a1aa; background: #fafafa; font-size: 10pt; color: #3f3f46; text-align: center; }

        .pdf-declaracion { margin-top: 14pt; padding: 10pt 12pt; border: 1px solid #18181b; background: #fafafa; font-size: 9.5pt; line-height: 1.55; text-align: justify; }

        .pdf-firmas { margin-top: 16pt; display: grid; grid-template-columns: 1fr; gap: 24pt; page-break-inside: avoid; }
        .pdf-firma-block { padding-top: 8pt; max-width: 320pt; }
        .pdf-firma-manuscrita-line { border-bottom: 1px solid #18181b; height: 64pt; margin-bottom: 4pt; }
        .pdf-firma-caption { font-size: 8.5pt; color: #52525b; }
        .pdf-firma-caption strong { display: block; font-size: 9.5pt; color: #18181b; font-weight: 600; margin-bottom: 1pt; }

        .pdf-footer { margin-top: 18pt; padding-top: 8pt; border-top: 1px solid #d4d4d8; font-size: 8pt; color: #71717a; display: flex; justify-content: space-between; gap: 12pt; }

        @media print {
          .pdf-items-table { page-break-inside: auto; }
          .pdf-items-table thead { display: table-header-group; }
          .pdf-items-table tr { page-break-inside: avoid; }
          .pdf-declaracion { page-break-inside: avoid; }
          .pdf-firmas { page-break-inside: avoid; }
          .pdf-footer { page-break-inside: avoid; }
        }
      `}</style>

      <div className="pdf-root">
        <header className="pdf-header">
          <div className="pdf-header-brand">
            {logoSignedUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- Signed URL externa, sin Next/Image en Puppeteer.
              <img src={logoSignedUrl} alt={consultoraName} className="pdf-header-logo" />
            ) : null}
            <div className="pdf-header-consultora">{consultoraName}</div>
          </div>
          <div className="pdf-header-title">
            <h1>Relevamiento de Agentes de Riesgo (RAR)</h1>
            <small>Resolución SRT N° 37/2010 · Decreto 658/96</small>
          </div>
        </header>

        <section className="pdf-section">
          <h2 className="pdf-section-title">Empleador</h2>
          <dl className="pdf-grid-2">
            <div className="pdf-field">
              <dt>Razón social</dt>
              <dd>{cliente.razon_social}</dd>
            </div>
            <div className="pdf-field">
              <dt>CUIT</dt>
              <dd>{cliente.cuit}</dd>
            </div>
            <div className="pdf-field">
              <dt>Domicilio</dt>
              <dd>{joinAddress(cliente)}</dd>
            </div>
            <div className="pdf-field">
              <dt>ART</dt>
              <dd>{cliente.art ?? '—'}</dd>
            </div>
            <div className="pdf-field">
              <dt>Período</dt>
              <dd>{periodo}</dd>
            </div>
          </dl>
        </section>

        <section className="pdf-section">
          <h2 className="pdf-section-title">Declaración de Agentes de Riesgo (DAR)</h2>
          {grupos.length > 0 ? (
            grupos.map((g) => (
              <div key={g.tipo} className="pdf-dar-grupo">
                <p className="pdf-dar-grupo-tipo">{TIPO_LABELS[g.tipo]}</p>
                <ul className="pdf-dar-list">
                  {g.items.map((a) => (
                    <li key={a.agente_id}>
                      <span className="pdf-dar-codigo">{a.codigo}</span>
                      {a.nombre}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          ) : (
            <p className="pdf-dar-vacio">
              No se declaran agentes de riesgo presentes en el establecimiento.
            </p>
          )}
        </section>

        <section className="pdf-section">
          <h2 className="pdf-section-title">Nómina de Trabajadores Expuestos (NTE)</h2>
          {hayExpuestos ? (
            <table className="pdf-items-table">
              <thead>
                <tr>
                  <th>Apellido y nombre</th>
                  <th>CUIL</th>
                  <th>Puesto(s)</th>
                  <th>Fecha ingreso</th>
                  <th>Agentes</th>
                </tr>
              </thead>
              <tbody>
                {nomina.expuestos.map((e) => (
                  <tr key={e.empleado_id}>
                    <td>
                      {e.apellido}, {e.nombre}
                    </td>
                    <td className="col-cuil">{e.cuil ?? '—'}</td>
                    <td>{e.puestos.length > 0 ? e.puestos.join(', ') : '—'}</td>
                    <td>{e.fecha_ingreso ? formatCivilDateAR(e.fecha_ingreso) : '—'}</td>
                    <td className="col-agentes">{e.agentes.map((a) => a.codigo).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="pdf-sin-expuestos">
              Sin personal expuesto a agentes de riesgo en el establecimiento.
            </p>
          )}
        </section>

        <section className="pdf-declaracion">
          <p>{RES_37_2010_DECLARACION}</p>
        </section>

        <section className="pdf-firmas">
          <div className="pdf-firma-block">
            <div className="pdf-firma-manuscrita-line" />
            <div className="pdf-firma-caption">
              <strong>Firma y aclaración del Responsable de HyS</strong>
              Matrícula N°: _______________________
            </div>
          </div>
        </section>

        <footer className="pdf-footer">
          <span>{cliente.razon_social}</span>
          <span>Generado el {generatedAtFormatted}</span>
        </footer>
      </div>
    </>
  );
}
