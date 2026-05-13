import type { RelevamientoMetadata } from './schema';

import { provinciaName } from '../common/site';
import { agenteHysLabel } from './schema';

/**
 * T-023-FU4 · SummaryContent print-safe para tipo='relevamiento'.
 *
 * Server Component sin Collapsible. Usa clases `pdf-summary-*` del `<style>`
 * inline de PrintTemplate (Tailwind no carga en Puppeteer setContent).
 */

type Props = {
  metadata: RelevamientoMetadata;
};

function fmtFecha(iso: string): string {
  const [y, mo, d] = iso.split('-');
  return `${d}/${mo}/${y}`;
}

export function RelevamientoMetadataSummaryContent({ metadata: m }: Props) {
  const isComplete = m.equipos_medicion !== undefined;

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
        <dt>Fecha</dt>
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

      {m.agentes_a_relevar.length > 0 && (
        <div className="pdf-summary-list-section">
          <p className="pdf-summary-list-title">Agentes a relevar</p>
          <ul className="pdf-summary-list">
            {m.agentes_a_relevar.map((a) => (
              <li key={a}>{agenteHysLabel(a)}</li>
            ))}
          </ul>
        </div>
      )}

      {m.equipos_medicion && (
        <div className="pdf-summary-list-section">
          <p className="pdf-summary-list-title">Equipos de medición</p>
          <p className="pdf-summary-prose">{m.equipos_medicion}</p>
        </div>
      )}
    </section>
  );
}
