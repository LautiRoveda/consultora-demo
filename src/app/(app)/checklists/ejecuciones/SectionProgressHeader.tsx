'use client';

/**
 * T-061a · Header sticky con barra de progreso de ítems obligatorios. Hand-rolled
 * (shadcn no trae Progress). `role="progressbar"` + `aria-live` para WCAG AA.
 * Sticky bajo el header mobile (top-14) y al tope en desktop (md:top-0).
 */
export function SectionProgressHeader({
  sectionTitle,
  sectionIndex,
  sectionCount,
  answeredRequired,
  totalRequired,
}: {
  sectionTitle: string;
  sectionIndex: number;
  sectionCount: number;
  answeredRequired: number;
  totalRequired: number;
}) {
  const pct = totalRequired === 0 ? 100 : Math.round((answeredRequired / totalRequired) * 100);

  return (
    <div className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-14 z-10 -mx-4 border-b px-4 py-3 backdrop-blur sm:px-6 md:top-0 lg:px-8">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-medium">{sectionTitle}</p>
        <span className="text-muted-foreground shrink-0 text-xs">
          Sección {sectionIndex + 1} de {sectionCount}
        </span>
      </div>
      <div
        className="bg-muted mt-2 h-2 overflow-hidden rounded"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progreso de ítems obligatorios"
      >
        <div className="bg-primary h-full rounded transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-muted-foreground mt-1 text-xs" aria-live="polite">
        {answeredRequired} de {totalRequired} ítems obligatorios respondidos
      </p>
    </div>
  );
}
