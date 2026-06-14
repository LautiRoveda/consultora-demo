import type { InformeTipo } from '@/app/(app)/informes/schema';

import { INFORME_TIPO_LABELS } from '@/app/(app)/informes/schema';

/**
 * T-023 · Helpers para nombrar el archivo PDF descargado.
 *
 * El consultor descarga varios PDFs/dia y los guarda en su carpeta de
 * Descargas. El nombre tiene que ser reconocible sin abrirlos:
 *   informe-<tipo>-<slug-titulo>-<YYYY-MM-DD>.pdf
 *
 * Reproducible: misma input → mismo output. Sin embedding de timestamps
 * variables.
 */

const MAX_TITULO_SLUG_LENGTH = 80;

/**
 * Normaliza un titulo a un slug ascii safe para nombre de archivo.
 *
 * Reglas:
 *  - NFKD para descomponer acentos, drop combining marks (ñ → n, é → e).
 *  - Lowercase.
 *  - Sustituye todo lo que no sea [a-z0-9] por '-'.
 *  - Colapsa runs de '-' y trimea '-' del borde.
 *  - Trunca a MAX_TITULO_SLUG_LENGTH sin cortar palabra a la mitad — si la
 *    posicion de corte cae adentro de un token alfanumerico, retrocede al
 *    ultimo '-'. Si no hay '-' (titulo de una sola palabra muy larga),
 *    trunca hard.
 *  - Vacio / solo whitespace / solo simbolos → 'informe'.
 */
export function slugifyTitulo(titulo: string): string {
  const normalized = titulo
    .normalize('NFKD')
    // Combining marks block — drop diacriticos despues del NFKD split.
    // Range ̀-ͯ cubre Combining Diacritical Marks (latin extended).
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (normalized.length === 0) return 'informe';

  if (normalized.length <= MAX_TITULO_SLUG_LENGTH) return normalized;

  const sliced = normalized.slice(0, MAX_TITULO_SLUG_LENGTH);
  const lastDash = sliced.lastIndexOf('-');
  // Si hay un '-' razonablemente cerca del final, cortamos ahi para no
  // mochar una palabra. Umbral 60% para que el cut no sea demasiado agresivo
  // en titulos donde el ultimo '-' esta al principio.
  if (lastDash >= MAX_TITULO_SLUG_LENGTH * 0.6) {
    return sliced.slice(0, lastDash);
  }
  return sliced;
}

export type BuildPdfFilenameArgs = {
  tipo: InformeTipo;
  titulo: string;
  /** ISO timestamp del informe — usamos la fecha (YYYY-MM-DD) para el sufijo. */
  createdAt: string | Date;
};

/**
 * Construye el filename canonico para el PDF de un informe.
 *
 * Formato: `informe-<tipo>-<slug-titulo>-<YYYY-MM-DD>.pdf`.
 * Ejemplo: `informe-rgrl-metalurgica-del-sur-sa-2026-05-12.pdf`.
 *
 * Notas:
 *  - El `tipo` se persiste tal cual del enum (lowercase, sin label es-AR) — el
 *    label es para UI humana, el filename quiere estabilidad y matching.
 *  - La fecha es UTC (la del registro DB). El consultor opera en AR (UTC-3),
 *    pero usar UTC evita off-by-one entre dispositivos con timezone distinto.
 */
export function buildPdfFilename(args: BuildPdfFilenameArgs): string {
  const date = typeof args.createdAt === 'string' ? new Date(args.createdAt) : args.createdAt;
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const fecha = `${yyyy}-${mm}-${dd}`;

  const slug = slugifyTitulo(args.titulo);
  return `informe-${args.tipo}-${slug}-${fecha}.pdf`;
}

/**
 * Label legible del tipo — reuso del registry de schema. Exportado para el
 * PrintTemplate (header del PDF).
 */
export function labelForTipo(tipo: InformeTipo): string {
  return INFORME_TIPO_LABELS[tipo] ?? tipo;
}

export type BuildEppPlanillaFilenameArgs = {
  apellido: string;
  fechaEntrega: string | Date;
};

/**
 * T-104 · Filename canonico para la planilla EPP Res SRT 299/11.
 *
 * Formato: `planilla-299-11-<slug-apellido>-<YYYY-MM-DD>.pdf`.
 * Ejemplo: `planilla-299-11-gonzalez-2026-05-23.pdf`.
 *
 * Notas:
 *  - Reusa `slugifyTitulo` para normalizar el apellido (acentos, ñ, símbolos).
 *  - Si el apellido es vacío/símbolos, `slugifyTitulo` devuelve `'informe'`
 *    como fallback. Para la planilla preferimos `'empleado'` para no confundir
 *    con el output de informes.
 *  - Fecha UTC para evitar off-by-one por timezone del dispositivo.
 */
export function buildEppPlanillaFilename(args: BuildEppPlanillaFilenameArgs): string {
  const date =
    typeof args.fechaEntrega === 'string' ? new Date(args.fechaEntrega) : args.fechaEntrega;
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const fecha = `${yyyy}-${mm}-${dd}`;

  let slug = slugifyTitulo(args.apellido);
  if (slug === 'informe') slug = 'empleado';
  return `planilla-299-11-${slug}-${fecha}.pdf`;
}

export type BuildRarPlanillaFilenameArgs = {
  /** Razón social del establecimiento (cliente). */
  razonSocial: string;
  /** Fecha de generación — usamos la fecha (YYYY-MM-DD) para el sufijo. */
  generatedAt: string | Date;
};

/**
 * T-144 · Filename canónico para la planilla RAR (Res SRT 37/2010).
 *
 * Formato: `planilla-rar-<slug-razonsocial>-<YYYY-MM-DD>.pdf`.
 * Ejemplo: `planilla-rar-metalurgica-del-sur-sa-2026-06-13.pdf`.
 *
 * Notas:
 *  - Reusa `slugifyTitulo` para normalizar la razón social (acentos, ñ, símbolos).
 *  - Fallback `'establecimiento'` si la razón social es vacía/símbolos.
 *  - El PDF se genera on-the-fly desde la nómina viva (no hay fecha de presentación
 *    hasta la Fase 3), así que el sufijo es la fecha de generación.
 *  - Fecha UTC para evitar off-by-one por timezone del dispositivo.
 */
export function buildRarPlanillaFilename(args: BuildRarPlanillaFilenameArgs): string {
  const date = typeof args.generatedAt === 'string' ? new Date(args.generatedAt) : args.generatedAt;
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const fecha = `${yyyy}-${mm}-${dd}`;

  let slug = slugifyTitulo(args.razonSocial);
  if (slug === 'informe') slug = 'establecimiento';
  return `planilla-rar-${slug}-${fecha}.pdf`;
}

export type BuildRarPlanillaHistoricaFilenameArgs = {
  /** Razón social del establecimiento (snapshot congelado al presentar). */
  razonSocial: string;
  /** Período (año) de la presentación — el sufijo es el período, no la fecha. */
  periodo: number;
};

/**
 * T-147 · Filename canónico para la descarga histórica de una planilla RAR
 * (desde el snapshot de `rar_presentaciones`).
 *
 * Formato: `planilla-rar-<slug-razonsocial>-<periodo>.pdf`.
 * Ejemplo: `planilla-rar-metalurgica-del-sur-sa-2026.pdf`.
 *
 * A diferencia de `buildRarPlanillaFilename` (que es on-the-fly y usa la fecha de
 * generación), la descarga histórica refleja lo presentado: el sufijo es el
 * PERÍODO de la presentación, no la fecha en que se descarga.
 */
export function buildRarPlanillaHistoricaFilename(
  args: BuildRarPlanillaHistoricaFilenameArgs,
): string {
  let slug = slugifyTitulo(args.razonSocial);
  if (slug === 'informe') slug = 'establecimiento';
  return `planilla-rar-${slug}-${args.periodo}.pdf`;
}

export type BuildChecklistInspeccionFilenameArgs = {
  /** Razón social del establecimiento (snapshot congelado al cierre). */
  establecimiento: string | null;
  /** ISO de cierre — usamos la fecha (YYYY-MM-DD) para el sufijo. */
  cerradaAt: string | Date;
};

/**
 * T-060b · Filename canónico del PDF de inspección RGRL.
 *
 * Formato: `inspeccion-rgrl-<slug-establecimiento>-<YYYY-MM-DD>.pdf`.
 * Ejemplo: `inspeccion-rgrl-metalurgica-del-sur-sa-2026-06-03.pdf`.
 * Fecha UTC (evita off-by-one por timezone del dispositivo).
 */
export function buildChecklistInspeccionFilename(
  args: BuildChecklistInspeccionFilenameArgs,
): string {
  const date = typeof args.cerradaAt === 'string' ? new Date(args.cerradaAt) : args.cerradaAt;
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const fecha = `${yyyy}-${mm}-${dd}`;

  let slug = slugifyTitulo(args.establecimiento ?? '');
  if (slug === 'informe') slug = 'establecimiento';
  return `inspeccion-rgrl-${slug}-${fecha}.pdf`;
}
