import type { ClienteSummary } from '@/app/(app)/clientes/queries';
import type { ProvinciaCode } from '@/shared/templates/common/site';
import type { InformeTipo } from '../schema';

import { PROVINCIAS_AR } from '@/shared/templates/common/site';

/**
 * T-050 · Helper puro client-safe que mappea un `ClienteSummary` a los values
 * del form metadata del wizard de informes.
 *
 * Los 5 schemas de metadata usan diferentes subsets de campos cliente:
 * - rgrl, relevamiento → `commonClientFieldsWithSite()`:
 *   razon_social + cuit + domicilio + localidad + provincia.
 * - capacitacion, accidente → `commonClientFields()`:
 *   razon_social + cuit + domicilio (sin localidad/provincia).
 * - otros → cherry-pick: razon_social + cuit (sin domicilio/localidad/provincia).
 *
 * El mapping pre-T-050 hardcoded `['rgrl','relevamiento']` ignoraba que
 * capacitacion/accidente usan domicilio (UX degradado: cliente popula
 * razon_social/cuit pero deja domicilio vacío en el form aunque está en la DB).
 * `CLIENT_FIELDS_BY_TIPO` declarativo evita drift forward.
 *
 * Provincia mapping (3 paths con fallback `''`):
 *   (1) code exacto (`'BA'`) → preserva.
 *   (2) name case-insensitive (`'Buenos Aires'`) → busca en PROVINCIAS_AR y
 *       convierte al code (`'BA'`).
 *   (3) free text legacy (`'Pcia. de Bs. As.'`) → leave blank + `console.warn`.
 *       El user completa manual desde el Select del form.
 *
 * NO usa `logger` (pino) porque se ejecuta client-side al click del
 * autocomplete — el warn aparece en devtools del consultor, suficiente para
 * diagnosticar provincias legacy mal cargadas.
 */

export type ClienteFormValues = {
  razon_social: string;
  cuit: string;
  domicilio?: string;
  localidad?: string;
  provincia?: ProvinciaCode | '';
};

type ClientFieldsConfig = {
  includeDomicilio: boolean;
  includeSite: boolean;
};

/**
 * Mapping declarativo InformeTipo → fields a popular. Exhaustive (TS narrows
 * forward — si se agrega un tipo nuevo a `INFORME_TIPOS` sin entry aquí, TS
 * marca error).
 */
export const CLIENT_FIELDS_BY_TIPO: Record<InformeTipo, ClientFieldsConfig> = {
  rgrl: { includeDomicilio: true, includeSite: true },
  relevamiento: { includeDomicilio: true, includeSite: true },
  capacitacion: { includeDomicilio: true, includeSite: false },
  accidente: { includeDomicilio: true, includeSite: false },
  otros: { includeDomicilio: false, includeSite: false },
};

export function mapClienteToFormValues(
  cliente: ClienteSummary,
  tipo: InformeTipo,
): ClienteFormValues {
  const config = CLIENT_FIELDS_BY_TIPO[tipo];

  const out: ClienteFormValues = {
    razon_social: cliente.razon_social,
    cuit: cliente.cuit,
  };

  if (config.includeDomicilio) {
    out.domicilio = cliente.domicilio ?? '';
  }

  if (config.includeSite) {
    out.localidad = cliente.localidad ?? '';
    out.provincia = mapProvincia(cliente.provincia);
  }

  return out;
}

function mapProvincia(provincia: string | null): ProvinciaCode | '' {
  if (!provincia) return '';

  // (1) Match code exacto: 'BA', 'CABA', etc.
  const asCode = PROVINCIAS_AR.find((p) => p.code === provincia);
  if (asCode) return asCode.code;

  // (2) Match name case-insensitive: 'Buenos Aires' → 'BA'.
  const lower = provincia.toLowerCase();
  const byName = PROVINCIAS_AR.find((p) => p.name.toLowerCase() === lower);
  if (byName) return byName.code;

  // (3) Free-text legacy ('Pcia. de Bs. As.', 'pcia bsas'): leave blank + warn.
  console.warn(
    `[T-050] Provincia "${provincia}" no matchea code ni name de PROVINCIAS_AR. ` +
      'El field quedará vacío en el form — completar manual desde el Select.',
  );
  return '';
}
