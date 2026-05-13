import type { RgrlMetadata } from './schema';

import {
  distribucionTurnoLabel,
  modalidadOperativaLabel,
  provinciaName,
  servicioHysModalidadLabel,
} from './schema';

/**
 * T-023-FU4 · SummaryContent print-safe para tipo='rgrl'.
 *
 * Server Component sin Collapsible — renderiza todos los campos planos.
 * Lo consume PrintTemplate via TEMPLATE_PRINT_REGISTRY. El web wrapper
 * `RgrlMetadataSummary` (client, compact + expand) queda intacto.
 *
 * CSS: usa clases `pdf-summary-*` que están en el `<style>` inline del
 * PrintTemplate. Las clases Tailwind NO funcionan acá porque Puppeteer
 * `setContent` renderea en about:blank sin baseURL y el `<link>` relativo
 * del CSS bundle no resuelve. Los `<dt>` + `<dd>` van directos como
 * children del `<dl>` para que `grid-template-columns: max-content 1fr`
 * los acomode en 2 cols (label izquierda, valor derecha).
 */

type Props = {
  metadata: RgrlMetadata;
};

function fmtFecha(iso: string): string {
  const [y, mo, d] = iso.split('-');
  return `${d}/${mo}/${y}`;
}

export function RgrlMetadataSummaryContent({ metadata: m }: Props) {
  const isComplete = m.codigo_ciiu !== undefined && m.riesgos_pre_detectados !== undefined;

  return (
    <section className="pdf-summary-section">
      <div className="pdf-summary-header">
        <h2 className="pdf-summary-title">Datos del relevamiento</h2>
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
        <dt>Localidad</dt>
        <dd>{m.localidad}</dd>
        <dt>Provincia</dt>
        <dd>{`${provinciaName(m.provincia)} (${m.provincia})`}</dd>
        <dt>Actividad principal</dt>
        <dd>{m.actividad_principal}</dd>
        {m.codigo_ciiu && (
          <>
            <dt>Código CIIU</dt>
            <dd>{m.codigo_ciiu}</dd>
          </>
        )}
        <dt>Empleados</dt>
        <dd>{m.cantidad_empleados.toLocaleString('es-AR')}</dd>
        <dt>Distribución de turnos</dt>
        <dd>{distribucionTurnoLabel(m.distribucion_turno)}</dd>
        <dt>Modalidad operativa</dt>
        <dd>{modalidadOperativaLabel(m.modalidad_operativa)}</dd>
        <dt>ART contratada</dt>
        <dd>{m.art_contratada}</dd>
        <dt>Servicio HyS</dt>
        <dd>{servicioHysModalidadLabel(m.servicio_hys_modalidad)}</dd>
        <dt>Fecha relevamiento</dt>
        <dd>{fmtFecha(m.fecha_relevamiento)}</dd>
      </dl>

      {m.areas_relevadas.length > 0 && (
        <div className="pdf-summary-list-section">
          <p className="pdf-summary-list-title">Áreas relevadas</p>
          <ul className="pdf-summary-list">
            {m.areas_relevadas.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {m.riesgos_pre_detectados && (
        <div className="pdf-summary-list-section">
          <p className="pdf-summary-list-title">Riesgos pre-detectados</p>
          <p className="pdf-summary-prose">{m.riesgos_pre_detectados}</p>
        </div>
      )}
    </section>
  );
}
