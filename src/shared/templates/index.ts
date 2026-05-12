/**
 * T-021 · Barrel del módulo de templates por tipo de informe.
 *
 * Forward: T-022 va a sumar `capacitacion`, `relevamiento`, `accidente`,
 * `otros`. Cada subcarpeta exporta `<tipo>MetadataSchema` + `<Tipo>Metadata`
 * type + `render<Tipo>MetadataAsPromptContext` + un `<Tipo>MetadataForm`.
 */

export * from './rgrl/schema';
export * from './rgrl/render';
