import type { InformeTipo } from '@/app/(app)/informes/schema';
import type { ComponentType } from 'react';
import type { FieldValues } from 'react-hook-form';

import { AccidenteMetadataSummaryContent } from '../accidente/AccidenteMetadataSummaryContent';
import { CapacitacionMetadataSummaryContent } from '../capacitacion/CapacitacionMetadataSummaryContent';
import { OtrosMetadataSummaryContent } from '../otros/OtrosMetadataSummaryContent';
import { RelevamientoMetadataSummaryContent } from '../relevamiento/RelevamientoMetadataSummaryContent';
import { RgrlMetadataSummaryContent } from '../rgrl/RgrlMetadataSummaryContent';

/**
 * T-023-FU4 · Registry print de templates por tipo de informe.
 *
 * Expone los `<Tipo>MetadataSummaryContent` (Server Components, sin
 * Collapsible) que PrintTemplate consume para generar el PDF via Puppeteer.
 *
 * Separación del `client.tsx`:
 *  - `client.tsx` arrastra los Client Components al bundle del navegador
 *    (FormComponent + SummaryComponent web con Collapsible).
 *  - `print.tsx` solo arrastra Server JSX sin `'use client'` — el HTML
 *    rendereado por Puppeteer no necesita hidratar nada.
 *
 * Mismo cast pattern que client.tsx: cada concrete `<Tipo>MetadataSummaryContent`
 * esta typado a su metadata especifica; aca los unificamos via `unknown` cast.
 * El consumer pasa la `metadata.data` que ya fue parseada por el Zod schema del
 * tipo activo en `getInformeMetadata`.
 */

export type PrintEntry = {
  /** Content component renderizable con `<SummaryContentComponent metadata={m} />`. */
  SummaryContentComponent: ComponentType<{ metadata: FieldValues }>;
};

export const TEMPLATE_PRINT_REGISTRY: Record<InformeTipo, PrintEntry> = {
  rgrl: {
    SummaryContentComponent:
      RgrlMetadataSummaryContent as unknown as PrintEntry['SummaryContentComponent'],
  },
  capacitacion: {
    SummaryContentComponent:
      CapacitacionMetadataSummaryContent as unknown as PrintEntry['SummaryContentComponent'],
  },
  relevamiento: {
    SummaryContentComponent:
      RelevamientoMetadataSummaryContent as unknown as PrintEntry['SummaryContentComponent'],
  },
  accidente: {
    SummaryContentComponent:
      AccidenteMetadataSummaryContent as unknown as PrintEntry['SummaryContentComponent'],
  },
  otros: {
    SummaryContentComponent:
      OtrosMetadataSummaryContent as unknown as PrintEntry['SummaryContentComponent'],
  },
};

export function getPrintTemplate(tipo: InformeTipo): PrintEntry {
  return TEMPLATE_PRINT_REGISTRY[tipo];
}
