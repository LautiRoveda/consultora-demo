import type { InformeStatus, InformeTipo } from '@/app/(app)/informes/schema';
import type { FieldValues } from 'react-hook-form';

import { MarkdownPreview } from '@/app/(app)/informes/[id]/MarkdownPreview';
import { INFORME_STATUS_LABELS, INFORME_TIPO_LABELS } from '@/app/(app)/informes/schema';
import { humanBytes, humanMime } from '@/shared/storage/format';
import { TEMPLATE_PRINT_REGISTRY } from '@/shared/templates/registry/print';

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
export type AttachmentForPrint = {
  id: string;
  kind: 'image' | 'file';
  filename: string;
  mime_type: string;
  size_bytes: number;
  caption: string | null;
  position: number;
  signedUrl: string | null;
};

export type PrintTemplateBranding = {
  /** Nombre de la consultora. Fallback al wordmark cuando no hay logo. */
  consultoraName: string;
  /** URL firmada del logo en el bucket consultora-logos. Null = sin logo. */
  logoSignedUrl: string | null;
};

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
  branding: PrintTemplateBranding;
  attachments: AttachmentForPrint[];
};

export function PrintTemplate({ informe, metadata, branding, attachments }: PrintTemplateProps) {
  const tipoLabel = INFORME_TIPO_LABELS[informe.tipo] ?? informe.tipo;
  const statusLabel = INFORME_STATUS_LABELS[informe.status] ?? informe.status;
  const fecha = new Date(informe.created_at).toLocaleDateString('es-AR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const idShort = informe.id.slice(0, 8);

  // T-023-FU4: PrintTemplate consume el SummaryContent (server-only, sin
  // Collapsible) en vez del SummaryComponent web (client, con expand/compact).
  // El web Collapsible no hidrata en Puppeteer y dejaba el trigger + chevron
  // inertes en pagina 1 del PDF.
  const SummaryContentComponent =
    metadata && metadata.tipo === informe.tipo
      ? TEMPLATE_PRINT_REGISTRY[metadata.tipo]?.SummaryContentComponent
      : null;

  // T-024: split attachments por tipo. images van a "Anexos visuales"
  // (renderizadas en pagina aparte). files van a tabla "Anexos descargables".
  const images = attachments
    .filter((a) => a.kind === 'image' && a.signedUrl)
    .sort((a, b) => a.position - b.position);
  const files = attachments.filter((a) => a.kind === 'file');

  return (
    <>
      {/* Print CSS — define page size, margins, font, page-break rules.
          Inline porque Puppeteer corre el render con CSS inherido del head.

          T-023-FU4 (#46+): margenes generosos (25/22/38/22 mm) replicados
          tanto en @page como en Puppeteer DEFAULT_MARGIN (render.ts). El
          @page es declarativo + backup; el control real viene del
          parametro `margin` en page.pdf(). Tener ambos sincronizados
          documenta intencion y evita drift si en futuro Puppeteer respeta
          @page sobre el parametro.

          .pdf-root padding reducido (era 22/18/24/18mm replicando el
          margin de Puppeteer y sumando ~44/36/54mm visual). Ahora 0:
          unica fuente de margen es Puppeteer/@page. Esto destraba a la
          primera pagina de tener cushion adicional que no se repite en
          paginas 2+ (causa secundaria del overlap persistente).

          @media print: bloque de controles de page-break para listas
          largas + headings + tablas + secciones. Sin esto, listas que
          aterrizan en el borde inferior pueden cortar items individuales
          que solapan con el footer. */}
      <style>{`
        @page { size: A4; margin: 25mm 22mm 38mm 22mm; }
        body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; font-size: 11pt; line-height: 1.5; color: #18181b; }
        .pdf-root { padding: 0; }
        .pdf-header { border-bottom: 1px solid #e4e4e7; padding-bottom: 12pt; margin-bottom: 16pt; }
        .pdf-brand { font-size: 9pt; color: #71717a; text-transform: uppercase; letter-spacing: 0.06em; }
        .pdf-title { font-size: 18pt; font-weight: 600; line-height: 1.25; margin: 6pt 0 4pt; color: #09090b; }
        .pdf-meta { font-size: 9pt; color: #52525b; }
        .pdf-meta strong { color: #18181b; font-weight: 600; }
        .pdf-section { margin-top: 14pt; }
        .pdf-section-title { font-size: 11pt; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: #52525b; margin-bottom: 8pt; }
        .pdf-body { margin-top: 16pt; }
        h1 { font-size: 16pt; font-weight: 600; margin: 14pt 0 8pt; color: #09090b; }
        h2 { font-size: 13pt; font-weight: 600; margin: 12pt 0 6pt; color: #18181b; }
        h3 { font-size: 11pt; font-weight: 600; margin: 10pt 0 4pt; color: #27272a; }
        p, li { margin: 4pt 0; }
        table { width: 100%; border-collapse: collapse; margin: 8pt 0; font-size: 10pt; }
        th, td { border: 1px solid #e4e4e7; padding: 4pt 6pt; text-align: left; }
        th { background: #fafafa; font-weight: 600; }
        blockquote { border-left: 2px solid #e4e4e7; padding-left: 10pt; color: #52525b; font-style: italic; margin: 8pt 0; }
        code { font-family: ui-monospace, monospace; font-size: 9pt; background: #f4f4f5; padding: 1pt 4pt; border-radius: 2pt; }
        hr { border: none; border-top: 1px solid #e4e4e7; margin: 14pt 0; }
        a { color: #18181b; text-decoration: underline; }

        /* SummaryContent — replicado como inline scoped porque Tailwind
           no carga en el contexto Puppeteer setContent + about:blank.
           Las URLs relativas del <link rel="stylesheet"> de Tailwind no
           resuelven ahí. Las páginas 2+ del PDF usan tag selectors (h1/h2/
           p/table) que sí estilizan vía estas mismas inline rules; FU4
           replica el mismo mecanismo para la sección de metadata. */
        .pdf-summary-section { margin-bottom: 1.25rem; }
        .pdf-summary-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; }
        .pdf-summary-title { font-size: 1rem; font-weight: 600; letter-spacing: -0.01em; margin: 0; }
        .pdf-summary-badge { display: inline-block; padding: 0.125rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 500; }
        .pdf-summary-badge--complete { background-color: #d1fae5; color: #047857; }
        .pdf-summary-badge--partial { background-color: #fef3c7; color: #b45309; }
        .pdf-summary-grid { display: grid; grid-template-columns: max-content 1fr; gap: 0.375rem 1rem; font-size: 0.875rem; margin: 0; }
        .pdf-summary-grid dt { color: #6b7280; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.03em; margin: 0; align-self: start; padding-top: 0.125rem; }
        .pdf-summary-grid dd { font-weight: 500; margin: 0; }
        .pdf-summary-list-section { margin-top: 0.75rem; }
        .pdf-summary-list-title { font-size: 0.75rem; color: #6b7280; text-transform: uppercase; letter-spacing: 0.03em; margin: 0 0 0.25rem 0; }
        .pdf-summary-list { list-style: disc; margin: 0; padding-left: 1.25rem; font-size: 0.875rem; }
        .pdf-summary-list li { margin-bottom: 0.125rem; }
        .pdf-summary-prose { font-size: 0.875rem; white-space: pre-wrap; margin: 0.25rem 0 0 0; }

        @media print {
          /* Buffer extra dentro del body antes del page break. Aunque el
             padding-bottom no se repite por pagina (CSS box-model), si la
             ultima pagina tiene contenido cerca del borde el padding lo
             empuja hacia arriba dentro del margin reservado. */
          body {
            padding-bottom: 10mm;
          }

          /* Headings: nunca quedan solos al final de pagina (page-break
             antes/despues evita "huerfano" de heading) + tope un poco
             mayor para que respiren al iniciar seccion. */
          h1, h2, h3 {
            page-break-after: avoid;
            margin-top: 1.5em;
          }

          /* Listas: si toda la lista no entra en la pagina actual, se
             permite el salto (no es page-break-inside: avoid absoluto
             porque listas largas SI deben poder cortar). Pero los items
             individuales tienen orphans/widows: 2 para que al menos 2
             items queden juntos en cada chunk. */
          ul, ol {
            page-break-inside: auto;
          }
          li {
            orphans: 2;
            widows: 2;
          }
          /* Primer/ultimo item de lista no debe quedar solo al final/inicio
             de pagina — fuerza que arrastre el siguiente/anterior. */
          ul > li:first-child, ol > li:first-child {
            page-break-after: avoid;
          }
          ul > li:last-child, ol > li:last-child {
            page-break-before: avoid;
          }

          /* Parrafos: orphans/widows 3 (heredado del default original) +
             margin-bottom para que un parrafo largo no toque el footer. */
          p {
            orphans: 3;
            widows: 3;
          }

          /* Secciones cortas no se cortan a la mitad (page-break-inside
             avoid solo aplica si la seccion entera entra en una pagina;
             si excede, se permite el corte). */
          section {
            page-break-inside: avoid;
          }

          /* Tablas: lo mismo. Tablas chicas no se cortan, las largas si. */
          table {
            page-break-inside: avoid;
          }
          /* Header de tabla repetido si la tabla cruza pagina (cuando
             corta porque excede). */
          thead {
            display: table-header-group;
          }
          tr {
            page-break-inside: avoid;
          }

          /* pre/blockquote/code blocks: chicos no se cortan. */
          pre, blockquote {
            page-break-inside: avoid;
          }
        }
      `}</style>

      <style>{`
        /* T-024: branding + anexos. Logo con dimensiones generosas (no
           uniformes — sharp pipeline ya hizo resize a max 600 px); el
           object-fit contain respeta aspect ratio. */
        .pdf-brand-logo { max-height: 48pt; max-width: 200pt; object-fit: contain; display: block; }
        .pdf-anexos-visuales { page-break-before: always; }
        .pdf-anexos-visuales-title { font-size: 14pt; font-weight: 600; margin: 0 0 12pt; color: #09090b; }
        .pdf-anexo-figure { margin: 0 0 18pt; page-break-inside: avoid; text-align: center; }
        .pdf-anexo-figure img { max-width: 100%; max-height: 180mm; object-fit: contain; display: block; margin: 0 auto; }
        .pdf-anexo-caption { font-size: 9pt; color: #52525b; margin-top: 6pt; }
        .pdf-anexos-files { margin-top: 16pt; page-break-inside: avoid; }
        .pdf-anexos-files-note { font-size: 9pt; color: #71717a; margin: 4pt 0 8pt; }

        /* T-095: signature block — pilar core del producto (matriculado firma
           cada informe antes de presentarlo). page-break-inside: avoid para
           que el bloque NO se parta entre páginas (si no entra al final de la
           última página, salta a una nueva). */
        .pdf-firma { margin-top: 24pt; padding-top: 14pt; border-top: 1px solid #e4e4e7; page-break-inside: avoid; }
        .pdf-firma-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24pt; }
        .pdf-firma-line { border-bottom: 1px solid #71717a; height: 28pt; margin-bottom: 4pt; }
        .pdf-firma-label { font-size: 9pt; color: #52525b; }
        .pdf-firma-field { margin-bottom: 10pt; }
        .pdf-firma-field-line { border-bottom: 1px solid #71717a; height: 14pt; margin-top: 2pt; }
      `}</style>

      <div className="pdf-root">
        <header className="pdf-header">
          {branding.logoSignedUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Puppeteer renderea el PDF: Next/Image no aplica (no hay client hydration, no hay loader server-side para signed URLs externas).
            <img
              src={branding.logoSignedUrl}
              alt={branding.consultoraName}
              className="pdf-brand-logo"
            />
          ) : (
            <div className="pdf-brand">{branding.consultoraName}</div>
          )}
          <h1 className="pdf-title">{informe.titulo}</h1>
          <div className="pdf-meta">
            <strong>{tipoLabel}</strong> · {statusLabel} · {fecha} · ID {idShort}
          </div>
        </header>

        {SummaryContentComponent && metadata && (
          <section className="pdf-section">
            {/* T-023-FU4: cada Content trae su propio <h2> del tipo
                ("Datos del relevamiento" / "...capacitación" / etc.),
                reemplazando el hardcode "Datos del establecimiento" anterior
                que era RGRL-especifico. */}
            <SummaryContentComponent metadata={metadata.data as FieldValues} />
          </section>
        )}

        <section className="pdf-body">
          <MarkdownPreview content={informe.contenido} />
        </section>

        {images.length > 0 && (
          <section className="pdf-anexos-visuales">
            <h2 className="pdf-anexos-visuales-title">Anexos visuales</h2>
            {images.map((img, idx) => (
              <figure key={img.id} className="pdf-anexo-figure">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.signedUrl ?? undefined} alt={img.caption ?? img.filename} />
                <figcaption className="pdf-anexo-caption">
                  Imagen {idx + 1}
                  {img.caption ? ` — ${img.caption}` : ''}
                </figcaption>
              </figure>
            ))}
          </section>
        )}

        {files.length > 0 && (
          <section className="pdf-anexos-files">
            <h2 className="pdf-anexos-visuales-title">Anexos descargables</h2>
            <p className="pdf-anexos-files-note">
              Los siguientes archivos están adjuntos al informe en la aplicación.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Archivo</th>
                  <th>Tipo</th>
                  <th>Tamaño</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.id}>
                    <td>{f.filename}</td>
                    <td>{humanMime(f.mime_type)}</td>
                    <td>{humanBytes(f.size_bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* T-095: bloque de firma del matriculado. SIEMPRE presente — el
            disclaimer profesional (CLAUDE.md) exige que un profesional firme
            cada informe antes de presentarlo legalmente. */}
        <section className="pdf-firma">
          <div className="pdf-firma-grid">
            <div>
              <div className="pdf-firma-line" />
              <p className="pdf-firma-label">Firma del matriculado</p>
            </div>
            <div>
              <div className="pdf-firma-field">
                <span className="pdf-firma-label">Aclaración:</span>
                <div className="pdf-firma-field-line" />
              </div>
              <div className="pdf-firma-field">
                <span className="pdf-firma-label">Matrícula N°:</span>
                <div className="pdf-firma-field-line" />
              </div>
              <div className="pdf-firma-field">
                <span className="pdf-firma-label">Fecha:</span>
                <div className="pdf-firma-field-line" />
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
