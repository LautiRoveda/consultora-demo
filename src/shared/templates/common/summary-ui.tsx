/**
 * T-022 · Helpers compartidos para los `<Tipo>MetadataSummary` (PARADA #3).
 *
 * Centraliza el componente `<Item>` (label + value en col) y los helpers de
 * formato (`formatFecha`). Los Summary por tipo importan estos en lugar de
 * duplicarlos.
 *
 * Client-safe — no usa server-only APIs.
 */

export function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

/** YYYY-MM-DD → DD/MM/YYYY (es-AR). */
export function formatFecha(iso: string): string {
  const [y, mo, d] = iso.split('-');
  return `${d}/${mo}/${y}`;
}

export function StatusBadge({ complete }: { complete: boolean }) {
  if (complete) {
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
        Datos completos
      </span>
    );
  }
  return (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
      Datos parciales
    </span>
  );
}
