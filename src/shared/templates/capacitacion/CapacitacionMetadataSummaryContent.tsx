import type { CapacitacionMetadata } from './schema';

import { PersonalizacionSummaryContent } from '../common/PersonalizacionSummary';
import { modalidadCapacitacionLabel } from './schema';
import { SECCION_LABEL_BY_ID_CAPACITACION } from './secciones';

/**
 * T-023-FU4 · SummaryContent print-safe para tipo='capacitacion'.
 *
 * Server Component sin Collapsible. Usa clases `pdf-summary-*` del `<style>`
 * inline de PrintTemplate (Tailwind no carga en Puppeteer setContent).
 */

type Props = {
  metadata: CapacitacionMetadata;
};

function fmtFecha(iso: string): string {
  const [y, mo, d] = iso.split('-');
  return `${d}/${mo}/${y}`;
}

export function CapacitacionMetadataSummaryContent({ metadata: m }: Props) {
  const isComplete = m.capacitador_matricula !== undefined && m.contenidos_resumen !== undefined;

  return (
    <section className="pdf-summary-section">
      <div className="pdf-summary-header">
        <h2 className="pdf-summary-title">Datos de la capacitación</h2>
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
        <dt>Fecha</dt>
        <dd>{fmtFecha(m.fecha_capacitacion)}</dd>
        <dt>Modalidad</dt>
        <dd>{modalidadCapacitacionLabel(m.modalidad)}</dd>
        <dt>Duración</dt>
        <dd>{`${m.duracion_horas} h`}</dd>
        <dt>Tema</dt>
        <dd>{m.tema_principal}</dd>
        <dt>Capacitador</dt>
        <dd>{m.capacitador_nombre}</dd>
        {m.capacitador_matricula && (
          <>
            <dt>Matrícula</dt>
            <dd>{m.capacitador_matricula}</dd>
          </>
        )}
        <dt>Asistentes previstos</dt>
        <dd>{m.cantidad_asistentes_prevista.toLocaleString('es-AR')}</dd>
      </dl>

      {m.contenidos_resumen && (
        <div className="pdf-summary-list-section">
          <p className="pdf-summary-list-title">Contenidos resumidos</p>
          <p className="pdf-summary-prose">{m.contenidos_resumen}</p>
        </div>
      )}

      <PersonalizacionSummaryContent
        campos={m.campos_personalizados}
        instrucciones={m.instrucciones_adicionales}
        secciones={m.secciones}
        seccionLabelById={SECCION_LABEL_BY_ID_CAPACITACION}
      />
    </section>
  );
}
