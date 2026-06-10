import type { CampoPersonalizado } from './campos-extra';

/**
 * T-138 fase 1 · Fragmentos de summary para la personalizacion, compartidos
 * por los 5 tipos. Sin directiva 'use client'/'use server': el fragmento UI
 * se monta dentro de los `<Tipo>MetadataSummary` (client) y el fragmento
 * print dentro de los `<Tipo>MetadataSummaryContent` (server, Puppeteer).
 *
 * Ausente → null: un informe sin personalizacion no muestra nada (tampoco
 * cambia el criterio `isComplete` de cada tipo — personalizar es opcional,
 * no completitud de datos).
 */

type Props = {
  campos?: readonly CampoPersonalizado[];
  instrucciones?: string;
};

/** Fragmento para los Summary UI (dentro del CollapsibleContent expandido). */
export function PersonalizacionSummary({ campos, instrucciones }: Props) {
  const hasCampos = campos !== undefined && campos.length > 0;
  if (!hasCampos && !instrucciones) return null;

  return (
    <div className="space-y-2 pt-2 text-sm">
      {hasCampos && (
        <div>
          <dt className="text-muted-foreground">Campos personalizados:</dt>
          <dd className="mt-1">
            <ul className="ml-4 list-disc space-y-0.5">
              {campos.map((c, i) => (
                <li key={i}>
                  <span className="text-muted-foreground">{c.label}:</span> {c.valor}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      )}
      {instrucciones && (
        <div>
          <dt className="text-muted-foreground">Instrucciones adicionales:</dt>
          <dd className="mt-1 whitespace-pre-wrap">{instrucciones}</dd>
        </div>
      )}
    </div>
  );
}

/**
 * Fragmento print-safe para los SummaryContent (clases `pdf-summary-*` del
 * `<style>` inline de PrintTemplate — Tailwind no carga en Puppeteer).
 */
export function PersonalizacionSummaryContent({ campos, instrucciones }: Props) {
  const hasCampos = campos !== undefined && campos.length > 0;
  if (!hasCampos && !instrucciones) return null;

  return (
    <>
      {hasCampos && (
        <div className="pdf-summary-list-section">
          <p className="pdf-summary-list-title">Campos personalizados</p>
          <ul className="pdf-summary-list">
            {campos.map((c, i) => (
              <li key={i}>
                {c.label}: {c.valor}
              </li>
            ))}
          </ul>
        </div>
      )}
      {instrucciones && (
        <div className="pdf-summary-list-section">
          <p className="pdf-summary-list-title">Instrucciones adicionales</p>
          <p className="pdf-summary-prose">{instrucciones}</p>
        </div>
      )}
    </>
  );
}
