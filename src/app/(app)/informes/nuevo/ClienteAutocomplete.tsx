'use client';

import type { ClienteSummary } from '@/app/(app)/clientes/queries';
import { Loader2, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { searchClientesAction } from '@/app/(app)/clientes/actions';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/shared/ui/popover';

/**
 * T-050 · ClienteAutocomplete del wizard step 2 de informes.
 *
 * Patrón Popover + Input manual (no shadcn `command` / cmdk — no está instalado
 * y agrega 17KB para un autocomplete simple de < 10 resultados). Si surge
 * fricción real con keyboard nav avanzado → follow-up T-050-FU1.
 *
 * State machine:
 * - Cliente seleccionado → muestra card "Cliente seleccionado: X" + botón Limpiar.
 * - Sin seleccionar → Input + Popover (open si query >= 2 chars).
 *   - loading → spinner + "Buscando..."
 *   - results > 0 → lista de buttons clickable.
 *   - results === 0 (post-fetch) → "Sin resultados — verificá el nombre o creá uno nuevo."
 *
 * Debounce 300ms inline (no hay hook compartido en el repo). El cleanup del
 * useEffect cancela el timeout en re-render y unmount.
 *
 * Error handling:
 * - UNAUTHENTICATED / NO_CONSULTORA → toast + silent fallback (results = []).
 * - INTERNAL_ERROR → silent fallback sin toast (UX: el user puede reintentar
 *   sin ruido si fue un blip transitorio del provider).
 */

const DEBOUNCE_MS = 300;
const MIN_CHARS = 2;

type Props = {
  selectedClienteId: string | null;
  selectedRazonSocial: string | null;
  onSelect: (cliente: ClienteSummary | null) => void;
  disabled?: boolean;
};

export function ClienteAutocomplete({
  selectedClienteId,
  selectedRazonSocial,
  onSelect,
  disabled,
}: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ClienteSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [didFetch, setDidFetch] = useState(false);
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup pendientes al unmount (no setState — solo cancel timer).
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // El debounce vive en el onChange (no useEffect) para evitar setState en
  // effect body (rule react-hooks/set-state-in-effect). Mismo resultado UX —
  // el state se actualiza solo cuando el user tipea, no por derived effects.
  function handleQueryChange(newQuery: string) {
    setQuery(newQuery);

    if (timerRef.current) clearTimeout(timerRef.current);

    const trimmed = newQuery.trim();
    if (trimmed.length < MIN_CHARS) {
      setResults([]);
      setLoading(false);
      setDidFetch(false);
      setOpen(false);
      return;
    }

    setLoading(true);
    setDidFetch(false);
    setOpen(true);
    timerRef.current = setTimeout(() => {
      void runSearch(trimmed);
    }, DEBOUNCE_MS);
  }

  async function runSearch(trimmed: string) {
    const res = await searchClientesAction(trimmed);
    setLoading(false);
    setDidFetch(true);
    if (res.ok) {
      setResults(res.results);
    } else {
      setResults([]);
      if (res.code === 'UNAUTHENTICATED' || res.code === 'NO_CONSULTORA') {
        toast.error('No se pudo buscar', { description: res.message });
      }
    }
  }

  function handleSelect(cliente: ClienteSummary) {
    onSelect(cliente);
    setQuery('');
    setResults([]);
    setDidFetch(false);
    setOpen(false);
  }

  function handleClear() {
    onSelect(null);
    setQuery('');
    setResults([]);
    setDidFetch(false);
    setOpen(false);
  }

  // --- Estado: cliente seleccionado ---------------------------------------

  if (selectedClienteId !== null) {
    return (
      <div className="rounded-md border bg-muted/40 p-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Cliente seleccionado
          </p>
          <p className="truncate text-sm font-medium">{selectedRazonSocial}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleClear}
          disabled={disabled}
          aria-label="Limpiar selección de cliente"
        >
          <X className="size-4" aria-hidden />
          Limpiar selección
        </Button>
      </div>
    );
  }

  // --- Estado: sin seleccionar (Input + Popover) --------------------------

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Buscar cliente por razón social…"
            disabled={disabled}
            className="pl-9"
            aria-label="Buscar cliente"
            aria-autocomplete="list"
            aria-expanded={open}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[var(--radix-popover-trigger-width)] p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {loading && (
          <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Buscando…
          </div>
        )}
        {!loading && results.length > 0 && (
          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {results.map((cliente) => (
              <li key={cliente.id} role="option" aria-selected="false">
                <button
                  type="button"
                  onClick={() => handleSelect(cliente)}
                  className="w-full px-4 py-2 text-left hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none"
                >
                  <div className="text-sm font-medium">{cliente.razon_social}</div>
                  <div className="text-xs text-muted-foreground">{cliente.cuit}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {!loading && didFetch && results.length === 0 && (
          <div className="px-4 py-3 text-sm text-muted-foreground">
            Sin resultados. Verificá el nombre o creá un cliente nuevo.
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
