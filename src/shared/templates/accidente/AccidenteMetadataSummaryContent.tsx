import type { AccidenteMetadata } from './schema';

import { gravedadLabel, parteCuerpoLabel, tipoLesionLabel } from './schema';

/**
 * T-023-FU4 · SummaryContent print-safe para tipo='accidente'.
 *
 * Server Component sin Collapsible. Usa clases `pdf-summary-*` del `<style>`
 * inline de PrintTemplate (Tailwind no carga en Puppeteer setContent).
 *
 * Título "Datos del incidente" (cambia respecto al web wrapper que usa
 * "Datos del accidente"): el rótulo "incidente" enfatiza el carácter
 * narrativo del informe (vs. el evento legal "accidente" en la ART).
 */

type Props = {
  metadata: AccidenteMetadata;
};

function fmtFecha(iso: string): string {
  const [y, mo, d] = iso.split('-');
  return `${d}/${mo}/${y}`;
}

export function AccidenteMetadataSummaryContent({ metadata: m }: Props) {
  const isComplete = m.dias_baja_estimados !== undefined;
  const lesionesLabel = m.tipo_lesion.map(tipoLesionLabel).join(', ');
  const partesLabel = m.partes_cuerpo_afectadas.map(parteCuerpoLabel).join(', ');

  return (
    <section className="pdf-summary-section">
      <div className="pdf-summary-header">
        <h2 className="pdf-summary-title">Datos del incidente</h2>
        <span
          className={`pdf-summary-badge pdf-summary-badge--${isComplete ? 'complete' : 'partial'}`}
        >
          {isComplete ? 'Datos completos' : 'Datos parciales'}
        </span>
      </div>

      <dl className="pdf-summary-grid">
        <dt>Razón social</dt>
        <dd>{m.razon_social}</dd>
        <dt>CUIT</dt>
        <dd>{m.cuit}</dd>
        <dt>Domicilio</dt>
        <dd>{m.domicilio}</dd>
        <dt>Fecha y hora</dt>
        <dd>{`${fmtFecha(m.fecha_accidente)} ${m.hora_accidente}`}</dd>
        <dt>Lugar</dt>
        <dd>{m.lugar_especifico}</dd>
        <dt>Puesto afectado</dt>
        <dd>{m.puesto_afectado}</dd>
        <dt>Gravedad</dt>
        <dd>{gravedadLabel(m.gravedad)}</dd>
        <dt>Lesión</dt>
        <dd>{lesionesLabel}</dd>
        <dt>Partes afectadas</dt>
        <dd>{partesLabel}</dd>
        <dt>Testigos presentes</dt>
        <dd>{m.testigos_presentes ? 'Sí' : 'No'}</dd>
        {typeof m.dias_baja_estimados === 'number' && (
          <>
            <dt>Días de baja estimados</dt>
            <dd>{m.dias_baja_estimados.toLocaleString('es-AR')}</dd>
          </>
        )}
      </dl>

      <div className="pdf-summary-list-section">
        <p className="pdf-summary-list-title">Descripción inicial</p>
        <p className="pdf-summary-prose">{m.descripcion_inicial}</p>
      </div>
    </section>
  );
}
