/**
 * T-022 · Constantes y lookups de sitio (provincias AR).
 *
 * Promovido desde `rgrl/schema.ts` (T-021) para que los schemas con
 * `commonClientFieldsWithSite` (RGRL, relevamiento, etc.) compartan la
 * misma fuente de verdad.
 */

export const PROVINCIAS_AR = [
  { code: 'CABA', name: 'Ciudad Autónoma de Buenos Aires' },
  { code: 'BA', name: 'Buenos Aires' },
  { code: 'CT', name: 'Catamarca' },
  { code: 'CC', name: 'Chaco' },
  { code: 'CH', name: 'Chubut' },
  { code: 'CB', name: 'Córdoba' },
  { code: 'CN', name: 'Corrientes' },
  { code: 'ER', name: 'Entre Ríos' },
  { code: 'FM', name: 'Formosa' },
  { code: 'JY', name: 'Jujuy' },
  { code: 'LP', name: 'La Pampa' },
  { code: 'LR', name: 'La Rioja' },
  { code: 'MZ', name: 'Mendoza' },
  { code: 'MN', name: 'Misiones' },
  { code: 'NQ', name: 'Neuquén' },
  { code: 'RN', name: 'Río Negro' },
  { code: 'SA', name: 'Salta' },
  { code: 'SJ', name: 'San Juan' },
  { code: 'SL', name: 'San Luis' },
  { code: 'SC', name: 'Santa Cruz' },
  { code: 'SF', name: 'Santa Fe' },
  { code: 'SE', name: 'Santiago del Estero' },
  { code: 'TF', name: 'Tierra del Fuego' },
  { code: 'TM', name: 'Tucumán' },
] as const;

export type ProvinciaCode = (typeof PROVINCIAS_AR)[number]['code'];

export const PROVINCIA_CODES = [
  'CABA',
  'BA',
  'CT',
  'CC',
  'CH',
  'CB',
  'CN',
  'ER',
  'FM',
  'JY',
  'LP',
  'LR',
  'MZ',
  'MN',
  'NQ',
  'RN',
  'SA',
  'SJ',
  'SL',
  'SC',
  'SF',
  'SE',
  'TF',
  'TM',
] as const satisfies readonly ProvinciaCode[];

const PROVINCIA_NAME_BY_CODE: Record<ProvinciaCode, string> = Object.fromEntries(
  PROVINCIAS_AR.map((p) => [p.code, p.name]),
) as Record<ProvinciaCode, string>;

export function provinciaName(code: ProvinciaCode): string {
  return PROVINCIA_NAME_BY_CODE[code];
}
