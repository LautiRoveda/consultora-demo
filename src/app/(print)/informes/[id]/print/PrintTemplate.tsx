import type { InformeStatus, InformeTipo } from '@/app/(app)/informes/schema';
import type { FieldValues } from 'react-hook-form';

import { MarkdownPreview } from '@/app/(app)/informes/[id]/MarkdownPreview';
import { INFORME_STATUS_LABELS, INFORME_TIPO_LABELS } from '@/app/(app)/informes/schema';
import { TEMPLATE_CLIENT_REGISTRY } from '@/shared/templates/registry/client';

/**
 * T-023 · Template imprimible reutilizado para los 5 tipos de informe.
 *
 * Server Component puro. NO hace I/O — recibe ya `informe` + `metadata` por
 * props (el page.tsx hace los fetches). Eso permite render via
 * `renderToStaticMarkup` o internal fetch sin diferencias.
 *
 * Layout (alineado al plan T-023 seccion 3):
 *  - Header: branding minimal + titulo + tipo · status · fecha · id corto.
 *  - Body: Summary del tipo (si hay metadata) + Markdown del contenido.
 *  - Footer: gestionado por Puppeteer via headerTemplate/footerTemplate
 *    (esa layer agrega "Pagina X de Y" + disclaimer en TODAS las paginas).
 *
 * Print CSS inline porque el footer/header de Puppeteer corre fuera del
 * body y no tiene acceso a las stylesheets externas. Mantener acá tambien
 * por consistencia.
 */
export type PrintTemplateProps = {
  informe: {
    id: string;
    tipo: InformeTipo;
    titulo: string;
    status: InformeStatus;
    contenido: string | null;
    created_at: string;
  };
  metadata: { tipo: InformeTipo; data: unknown } | null;
};

export function PrintTemplate({ informe, metadata }: PrintTemplateProps) {
  const tipoLabel = INFORME_TIPO_LABELS[informe.tipo] ?? informe.tipo;
  const statusLabel = INFORME_STATUS_LABELS[informe.status] ?? informe.status;
  const fecha = new Date(informe.created_at).toLocaleDateString('es-AR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const idShort = informe.id.slice(0, 8);

  const SummaryComponent =
    metadata && metadata.tipo === informe.tipo
      ? TEMPLATE_CLIENT_REGISTRY[metadata.tipo]?.SummaryComponent
      : null;

  return (
    <>
      {/* Print CSS — define page size, margins, font, page-break rules.
          Inline porque Puppeteer corre el render con CSS inherido del head. */}
      <style>{`
        @page { size: A4; margin: 0; }
        body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; font-size: 11pt; line-height: 1.5; color: #18181b; }
        .pdf-root { padding: 22mm 18mm 24mm 18mm; }
        .pdf-header { border-bottom: 1px solid #e4e4e7; padding-bottom: 12pt; margin-bottom: 16pt; }
        .pdf-brand { font-size: 9pt; color: #71717a; text-transform: uppercase; letter-spacing: 0.06em; }
        .pdf-title { font-size: 18pt; font-weight: 600; line-height: 1.25; margin: 6pt 0 4pt; color: #09090b; }
        .pdf-meta { font-size: 9pt; color: #52525b; }
        .pdf-meta strong { color: #18181b; font-weight: 600; }
        .pdf-section { margin-top: 14pt; }
        .pdf-section-title { font-size: 11pt; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: #52525b; margin-bottom: 8pt; }
        .pdf-body { margin-top: 16pt; }
        h1 { font-size: 16pt; font-weight: 600; margin: 14pt 0 8pt; page-break-after: avoid; color: #09090b; }
        h2 { font-size: 13pt; font-weight: 600; margin: 12pt 0 6pt; page-break-after: avoid; color: #18181b; }
        h3 { font-size: 11pt; font-weight: 600; margin: 10pt 0 4pt; page-break-after: avoid; color: #27272a; }
        p, li { orphans: 3; widows: 3; margin: 4pt 0; }
        table { width: 100%; border-collapse: collapse; margin: 8pt 0; font-size: 10pt; page-break-inside: avoid; }
        th, td { border: 1px solid #e4e4e7; padding: 4pt 6pt; text-align: left; }
        th { background: #fafafa; font-weight: 600; }
        pre, blockquote { page-break-inside: avoid; }
        blockquote { border-left: 2px solid #e4e4e7; padding-left: 10pt; color: #52525b; font-style: italic; margin: 8pt 0; }
        code { font-family: ui-monospace, monospace; font-size: 9pt; background: #f4f4f5; padding: 1pt 4pt; border-radius: 2pt; }
        hr { border: none; border-top: 1px solid #e4e4e7; margin: 14pt 0; }
        a { color: #18181b; text-decoration: underline; }
      `}</style>

      <div className="pdf-root">
        <header className="pdf-header">
          <div className="pdf-brand">ConsultoraDemo</div>
          <h1 className="pdf-title">{informe.titulo}</h1>
          <div className="pdf-meta">
            <strong>{tipoLabel}</strong> · {statusLabel} · {fecha} · ID {idShort}
          </div>
        </header>

        {SummaryComponent && metadata && (
          <section className="pdf-section">
            <div className="pdf-section-title">Datos del establecimiento</div>
            <SummaryComponent metadata={metadata.data as FieldValues} />
          </section>
        )}

        <section className="pdf-body">
          <MarkdownPreview content={informe.contenido} />
        </section>
      </div>
    </>
  );
}
