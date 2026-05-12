/**
 * T-021 · Barrel del modulo de templates por tipo de informe.
 * T-022 · Suma capacitacion, relevamiento, accidente, otros + common + registry.
 *
 * Cada subcarpeta exporta:
 * - `<tipo>MetadataSchema` + `<Tipo>Metadata` type.
 * - `render<Tipo>MetadataAsPromptContext`.
 * - `normalize<Tipo>Metadata`.
 * - Lookups + constantes UI.
 *
 * El registry (`./registry/server`) consume los 5 tipos. Importar desde aca
 * solo si necesitas todo; sino, importa directo del subpath del tipo.
 */

// Common (compartido por todos)
export * from './common/cuit';
export * from './common/sanitize';
export * from './common/schema';
export * from './common/site';
export * from './common/areas';

// Tipos
export * from './rgrl/schema';
export * from './rgrl/render';
export * from './capacitacion/schema';
export * from './capacitacion/render';
export * from './relevamiento/schema';
export * from './relevamiento/render';
export * from './accidente/schema';
export * from './accidente/render';
export * from './otros/schema';
export * from './otros/render';

// Registry
export * from './registry/server';
