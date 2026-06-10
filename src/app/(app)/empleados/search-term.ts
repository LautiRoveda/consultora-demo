/**
 * T-134 · Saneo del término de búsqueda que se interpola en el `.or()` crudo de
 * `searchEmpleadosByNombre`.
 *
 * PORQUÉ: el `.or()` recibe un string LITERAL de sintaxis PostgREST, donde `,`
 * separa condiciones, `(` `)` agrupan y `"` abre quoting — a diferencia de
 * `.ilike(col, valor)`, donde el builder parametriza el valor y nada de esto es
 * sintaxis. El escape de wildcards LIKE no neutraliza esos caracteres
 * estructurales; además, en valores de `like`/`ilike` PostgREST trata `*` como
 * alias de `%`, que el escape tampoco cubría.
 *
 * Estrategia: allowlist name-safe. Es un autocomplete de NOMBRE — letras con
 * acentos, dígitos, espacio, apóstrofo recto/tipográfico, punto y guion cubren
 * los nombres reales; descartar el resto elimina la sintaxis estructural de
 * raíz sin costo de UX. Pura y sin 'server-only' para testearla aislada.
 *
 * Orden de operaciones (importa):
 * 1. trim + cap 100 (límite pre-existente).
 * 2. Allowlist — `\p{M}` conserva acentos de input NFD (letra + combinante).
 * 3. trim final: el strip puede dejar bordes huérfanos (", Mendoza" → " Mendoza").
 * 4. Escape de wildcards LIKE — hoy no-op (el allowlist ya excluye `\` `%` `_`)
 *    pero queda como defensa en profundidad si el charset se amplía. Backslash
 *    primero para no duplicar los que agregan los otros dos replace.
 */
export function sanitizeNombreSearchTerm(raw: string): string {
  const recortado = raw.trim().slice(0, 100);
  const saneado = recortado.replace(/[^\p{L}\p{M}\p{N}\s'’.-]/gu, '').trim();
  return saneado.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
