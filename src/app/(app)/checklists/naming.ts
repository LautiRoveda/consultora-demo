// Lógica pura de nombres de template (sin 'server-only' ni I/O) → unit-testeable.
// La usa queries.computeUniqueTemplateName tras leer los nombres activos del tenant.

const NOMBRE_MAX = 200;

/**
 * Devuelve un nombre libre dentro de `taken` (los nombres de template activos del
 * tenant). `base` si está libre; si no, `base (copia)`, `base (copia 2)`, … Capa
 * cada candidato a `max` caracteres (CHECK nombre ≤ 200).
 */
export function pickUniqueTemplateName(
  base: string,
  taken: ReadonlySet<string>,
  max: number = NOMBRE_MAX,
): string {
  const cap = (s: string) => (s.length <= max ? s : s.slice(0, max));

  const capped = cap(base);
  if (!taken.has(capped)) return capped;

  const first = cap(`${base} (copia)`);
  if (!taken.has(first)) return first;

  for (let i = 2; i < 1000; i += 1) {
    const candidate = cap(`${base} (copia ${i})`);
    if (!taken.has(candidate)) return candidate;
  }
  // Prácticamente inalcanzable; la action reintenta ante 23505 igual.
  return cap(`${base} (copia ${Date.now()})`);
}
