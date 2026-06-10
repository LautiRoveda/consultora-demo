import type { OtrosMetadata } from './schema';

import { PersonalizacionSummaryContent } from '../common/PersonalizacionSummary';

/**
 * T-023-FU4 · SummaryContent print-safe para tipo='otros'.
 *
 * Server Component sin Collapsible. Usa clases `pdf-summary-*` del `<style>`
 * inline de PrintTemplate (Tailwind no carga en Puppeteer setContent).
 */

type Props = {
  metadata: OtrosMetadata;
};

export function OtrosMetadataSummaryContent({ metadata: m }: Props) {
  const isComplete = m.objetivos !== undefined;

  return (
    <section className="pdf-summary-section">
      <div className="pdf-summary-header">
        <h2 className="pdf-summary-title">Datos del informe</h2>
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
        <dt>Tema</dt>
        <dd>{m.tema_informe}</dd>
      </dl>

      {m.objetivos && (
        <div className="pdf-summary-list-section">
          <p className="pdf-summary-list-title">Objetivos / contexto</p>
          <p className="pdf-summary-prose">{m.objetivos}</p>
        </div>
      )}

      <PersonalizacionSummaryContent
        campos={m.campos_personalizados}
        instrucciones={m.instrucciones_adicionales}
      />
    </section>
  );
}
