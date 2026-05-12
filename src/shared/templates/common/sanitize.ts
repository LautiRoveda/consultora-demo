/**
 * T-022 · Sanitizadores compartidos para inyeccion segura en prompts de Claude.
 *
 * Extraido de `rgrl/render.ts` (T-021) para que los 5 renders apliquen la
 * misma defensa contra prompt-injection.
 *
 * Estrategia: el bloque user-controlled (razon social, descripciones libres)
 * se prepende al user message del API call. Un member legitimo podria meter
 * en `razon_social` algo como ```ignore previous instructions```. La
 * sanitizacion escapa los caracteres que rompen el contenedor markdown
 * sin destruir la lectura humana.
 */

/**
 * Sanitiza un string user-controlled antes de meterlo en el markdown del prompt:
 *  - Triple backticks → tres comillas simples.
 *  - Backticks simples → comillas simples.
 *  - `\n#` (heading injector tras newline) → `\n - #`.
 *
 * Length caps ya estan aplicados por Zod en cada `<tipo>MetadataSchema`.
 */
export function sanitizeField(s: string): string {
  return s.replace(/```/g, "'''").replace(/`/g, "'").replace(/\n#/g, '\n - #');
}

/**
 * Renderiza texto libre como blockquote por linea. Cada linea se prefija con
 * `> ` — limita la capacidad del campo de inyectar estructura markdown libre
 * (headings, listas anidadas, codeblocks).
 *
 * Aplica a `riesgos_pre_detectados` (RGRL), `descripcion_inicial` (accidente),
 * `objetivos` (otros), `contenidos_resumen` (capacitacion), `equipos_medicion`
 * (relevamiento). Sanitiza ANTES de blockquotear (el caller pasa el string ya
 * sanitizado).
 */
export function renderAsBlockquote(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line.trim()}`)
    .filter((line) => line !== '> ')
    .join('\n');
}

/** Fecha YYYY-MM-DD (formato nativo de `<Input type="date">`). */
export const FECHA_ISO_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Hora HH:MM 24h (formato nativo de `<Input type="time">`). */
export const HORA_HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
