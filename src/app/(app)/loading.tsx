/**
 * T-095 · Loading state genérico para todas las páginas autenticadas.
 *
 * Next.js renderiza este componente automáticamente como Suspense boundary
 * mientras los children async de cada page resuelven. Mantiene el shell
 * autenticado visible (el layout `(app)` envuelve este loading) y muestra un
 * skeleton que aproxima la estructura común de las páginas del producto
 * (header + grid de cards).
 *
 * Pages específicas pueden sumar su propio `loading.tsx` para skeletons más
 * fieles a su layout — este es el fallback genérico.
 */
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <div className="bg-muted h-8 w-48 animate-pulse rounded" />
        <div className="bg-muted/60 h-4 w-96 max-w-full animate-pulse rounded" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="bg-muted/40 h-32 animate-pulse rounded-lg" />
        <div className="bg-muted/40 h-32 animate-pulse rounded-lg" />
      </div>
      <span className="sr-only">Cargando…</span>
    </div>
  );
}
