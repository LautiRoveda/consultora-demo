import type { EntregaForPlanilla, EntregaItemForPlanilla } from '@/app/(app)/epp/entregas/queries';

import { RES_299_11_DECLARACION } from '@/shared/templates/epp-planilla/declaracion-legal';

/**
 * T-104 · Template imprimible para la Planilla Res SRT 299/11.
 *
 * Server Component puro — sin I/O. Recibe los datos ya hidratados por el
 * `page.tsx` que envuelve. Render alineado a los requisitos legales mínimos
 * de la Res SRT 299/11 art. 1-6: identificación de empleador, trabajador,
 * EPP entregados, firma del trabajador y firma manuscrita del responsable
 * de HyS post-impresión.
 *
 * CSS inline obligatorio: Puppeteer renderea via setContent en about:blank,
 * por lo que los stylesheets externos de Tailwind no resuelven. Cualquier
 * estilo visible en el PDF tiene que estar acá adentro de `<style>`.
 */

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

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return dateFormatter.format(new Date(value));
}

function joinAddress(cliente: EntregaForPlanilla['cliente']): string {
  if (!cliente) return '—';
  const parts = [cliente.domicilio, cliente.localidad, cliente.provincia].filter((p): p is string =>
    Boolean(p && p.trim().length > 0),
  );
  return parts.length > 0 ? parts.join(', ') : '—';
}

function itemMarcaModelo(item: EntregaItemForPlanilla): string {
  return (
    [item.marca_entregada, item.modelo_entregado]
      .filter((p): p is string => Boolean(p && p.trim().length > 0))
      .join(' · ') || '—'
  );
}

export type EppPlanillaTemplateProps = {
  entrega: EntregaForPlanilla;
  firmaSignedUrl: string | null;
  logoSignedUrl: string | null;
  consultoraName: string;
  generatedAt: string;
};

export function EppPlanillaTemplate({
  entrega,
  firmaSignedUrl,
  logoSignedUrl,
  consultoraName,
  generatedAt,
}: EppPlanillaTemplateProps) {
  const empleado = entrega.empleado;
  const cliente = entrega.cliente;
  const fechaEntrega = formatDate(entrega.fecha_entrega);
  const firmadoAt = entrega.firmado_at
    ? dateTimeFormatter.format(new Date(entrega.firmado_at))
    : '—';
  const idShort = entrega.id.slice(0, 8);
  const generatedAtFormatted = dateTimeFormatter.format(new Date(generatedAt));

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

        .pdf-observaciones { margin-top: 6pt; font-size: 9.5pt; color: #3f3f46; font-style: italic; }

        .pdf-items-table { width: 100%; border-collapse: collapse; margin-top: 6pt; font-size: 9pt; }
        .pdf-items-table th, .pdf-items-table td { border: 1px solid #d4d4d8; padding: 4pt 6pt; text-align: left; vertical-align: top; }
        .pdf-items-table th { background: #f4f4f5; font-weight: 600; text-transform: uppercase; font-size: 8pt; letter-spacing: 0.04em; color: #3f3f46; }
        .pdf-items-table td.col-cantidad { text-align: center; }
        .pdf-items-table td.col-numero-serie { font-family: ui-monospace, monospace; font-size: 8.5pt; }
        .pdf-items-table td.col-normativa { font-size: 8pt; color: #52525b; }

        .pdf-declaracion { margin-top: 14pt; padding: 10pt 12pt; border: 1px solid #18181b; background: #fafafa; font-size: 9.5pt; line-height: 1.55; text-align: justify; }

        .pdf-firmas { margin-top: 16pt; display: grid; grid-template-columns: 1fr 1fr; gap: 24pt; page-break-inside: avoid; }
        .pdf-firma-block { padding-top: 8pt; }
        .pdf-firma-operario-img { width: 100%; max-height: 80pt; object-fit: contain; display: block; margin: 0 auto 4pt; border-bottom: 1px solid #71717a; padding-bottom: 4pt; }
        .pdf-firma-manuscrita-line { border-bottom: 1px solid #18181b; height: 64pt; margin-bottom: 4pt; }
        .pdf-firma-caption { font-size: 8.5pt; color: #52525b; text-align: center; }
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
            <h1>Planilla de Entrega de Elementos de Protección Personal</h1>
            <small>Resolución SRT N° 299/11</small>
          </div>
        </header>

        <section className="pdf-section">
          <h2 className="pdf-section-title">Empleador</h2>
          <dl className="pdf-grid-2">
            <div className="pdf-field">
              <dt>Razón social</dt>
              <dd>{cliente?.razon_social ?? '—'}</dd>
            </div>
            <div className="pdf-field">
              <dt>CUIT</dt>
              <dd>{cliente?.cuit ?? '—'}</dd>
            </div>
            <div className="pdf-field">
              <dt>Nombre fantasía</dt>
              <dd>{cliente?.nombre_fantasia ?? '—'}</dd>
            </div>
            <div className="pdf-field">
              <dt>Domicilio</dt>
              <dd>{joinAddress(cliente)}</dd>
            </div>
          </dl>
        </section>

        <section className="pdf-section">
          <h2 className="pdf-section-title">Trabajador</h2>
          <dl className="pdf-grid-2">
            <div className="pdf-field">
              <dt>Apellido y nombre</dt>
              <dd>{empleado ? `${empleado.apellido}, ${empleado.nombre}` : '—'}</dd>
            </div>
            <div className="pdf-field">
              <dt>DNI</dt>
              <dd>{empleado?.dni ?? '—'}</dd>
            </div>
            <div className="pdf-field">
              <dt>CUIL</dt>
              <dd>{empleado?.cuil ?? '—'}</dd>
            </div>
            <div className="pdf-field">
              <dt>Puesto</dt>
              <dd>{empleado?.puesto ?? '—'}</dd>
            </div>
            <div className="pdf-field">
              <dt>Fecha ingreso</dt>
              <dd>{formatDate(empleado?.fecha_ingreso ?? null)}</dd>
            </div>
            <div className="pdf-field">
              <dt>Fecha entrega</dt>
              <dd>{fechaEntrega}</dd>
            </div>
          </dl>
          {entrega.observaciones ? (
            <p className="pdf-observaciones">Observaciones: {entrega.observaciones}</p>
          ) : null}
        </section>

        <section className="pdf-section">
          <h2 className="pdf-section-title">Elementos entregados</h2>
          <table className="pdf-items-table">
            <thead>
              <tr>
                <th>Categoría</th>
                <th>Descripción</th>
                <th>Cant.</th>
                <th>Marca / Modelo</th>
                <th>N° serie</th>
                <th>Motivo</th>
                <th>Normativa</th>
              </tr>
            </thead>
            <tbody>
              {entrega.items.map((it) => (
                <tr key={it.id}>
                  <td>{it.categoria_nombre}</td>
                  <td>{it.item_nombre}</td>
                  <td className="col-cantidad">{it.cantidad}</td>
                  <td>{itemMarcaModelo(it)}</td>
                  <td className="col-numero-serie">{it.numero_serie ?? '—'}</td>
                  <td>{MOTIVO_LABELS[it.motivo_entrega] ?? it.motivo_entrega}</td>
                  <td className="col-normativa">{it.item_normativa ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="pdf-declaracion">
          <p>{RES_299_11_DECLARACION}</p>
        </section>

        <section className="pdf-firmas">
          <div className="pdf-firma-block">
            {firmaSignedUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- Signed URL externa con TTL; sin Next/Image en Puppeteer.
              <img
                src={firmaSignedUrl}
                alt="Firma del trabajador"
                className="pdf-firma-operario-img"
              />
            ) : (
              <div className="pdf-firma-manuscrita-line" />
            )}
            <div className="pdf-firma-caption">
              <strong>Firma del trabajador</strong>
              {empleado ? (
                <>
                  {empleado.apellido}, {empleado.nombre}
                  {empleado.dni ? ` — DNI ${empleado.dni}` : ''}
                </>
              ) : (
                '—'
              )}
              <div>Firmado el {firmadoAt}</div>
            </div>
          </div>

          <div className="pdf-firma-block">
            <div className="pdf-firma-manuscrita-line" />
            <div className="pdf-firma-caption">
              <strong>Firma y aclaración del Responsable de HyS</strong>
              Matrícula N°: _______________________
            </div>
          </div>
        </section>

        <footer className="pdf-footer">
          <span>Entrega ID {idShort}</span>
          <span>Generado el {generatedAtFormatted}</span>
        </footer>
      </div>
    </>
  );
}
