'use client';

import type { CalendarEventStatus, CalendarEventTipo } from './defaults';
import type { DrawerState } from './EventDrawer';
import type { CalendarEventRow } from './queries';
import type { UrlState } from './url-state';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';

import { Button } from '@/shared/ui/button';
import { TooltipProvider } from '@/shared/ui/tooltip';

import { CalendarFilters } from './CalendarFilters';
import { CalendarMonthView } from './CalendarMonthView';
import { EventDrawer } from './EventDrawer';
import { addMonthsToYM, buildSearchParams } from './url-state';

const MONTH_LABELS_ES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

type Props = {
  initialEvents: CalendarEventRow[];
  initialMonth: { year: number; month: number };
  initialFilters: { tipo: CalendarEventTipo[]; status: CalendarEventStatus[] };
  /** Si la URL trae `?event=<uuid>`, abre el drawer en mode view al cargar. */
  initialEventOpen: string | null;
  currentUserId: string;
  currentUserRole: 'owner' | 'member';
};

/**
 * Intent local del drawer (create/edit). El modo `view` no es un intent local
 * — se DERIVA de `?event=` en la URL para mantener una sola fuente de verdad
 * (compatible con back/forward del browser y links shareables).
 */
type LocalIntent =
  | { mode: 'create'; fechaPrepop: string | null }
  | { mode: 'edit'; eventId: string }
  | null;

export function CalendarView({
  initialEvents,
  initialMonth,
  initialFilters,
  initialEventOpen,
  currentUserId,
  currentUserRole,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // `viewEventId` se deriva del searchParam `event`. NO duplicamos en state
  // local para evitar la trampa "setState dentro de useEffect" que sucede al
  // sincronizar dos fuentes de verdad. El intent local (create/edit) sigue
  // en useState porque NO se persiste en URL.
  const [intent, setIntent] = useState<LocalIntent>(null);
  const viewEventId = searchParams.get('event') ?? initialEventOpen;

  const drawer: DrawerState = useMemo(() => {
    if (intent) return intent;
    if (viewEventId) return { mode: 'view', eventId: viewEventId };
    return { mode: 'closed' };
  }, [intent, viewEventId]);

  const pushSearchParams = useCallback(
    (updates: Partial<UrlState>) => {
      // Estado actual derivado de la URL para no perder filtros al actualizar.
      const current: Partial<UrlState> = {
        year: initialMonth.year,
        month: initialMonth.month,
        tipo: initialFilters.tipo,
        status: initialFilters.status,
        event: searchParams.get('event'),
      };
      const next = { ...current, ...updates };
      const qs = buildSearchParams(next);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [initialMonth, initialFilters, searchParams, pathname, router],
  );

  const openCreateOnDay = useCallback(
    (fechaIso: string | null) => {
      setIntent({ mode: 'create', fechaPrepop: fechaIso });
      if (searchParams.get('event')) pushSearchParams({ event: null });
    },
    [pushSearchParams, searchParams],
  );

  const openViewEvent = useCallback(
    (eventId: string) => {
      setIntent(null); // limpiar intent local para que la derivacion del view del URL gane
      pushSearchParams({ event: eventId });
    },
    [pushSearchParams],
  );

  const openEditEvent = useCallback((eventId: string) => {
    setIntent({ mode: 'edit', eventId });
  }, []);

  const closeDrawer = useCallback(() => {
    setIntent(null);
    if (searchParams.get('event')) pushSearchParams({ event: null });
  }, [pushSearchParams, searchParams]);

  const changeMonth = useCallback(
    (delta: -1 | 1) => {
      const next = addMonthsToYM(initialMonth, delta);
      pushSearchParams({ year: next.year, month: next.month, event: null });
      setIntent(null);
    },
    [initialMonth, pushSearchParams],
  );

  const applyFilters = useCallback(
    (next: { tipo: CalendarEventTipo[]; status: CalendarEventStatus[] }) => {
      pushSearchParams({ tipo: next.tipo, status: next.status });
    },
    [pushSearchParams],
  );

  /**
   * Callback post-mutation. Las acciones (`create`/`update`/`complete`/
   * `cancel`) llaman a esto para sincronizar UI:
   *  - cierra el drawer si corresponde,
   *  - opcionalmente navega a otro mes/event (recurrencia → mes del nextEvent),
   *  - dispara `router.refresh()` que re-ejecuta page.tsx con searchParams
   *    actuales y baja initialEvents fresco.
   */
  const handleMutated = useCallback(
    (opts: {
      closeDrawer?: boolean;
      gotoEventId?: string | null;
      gotoMonth?: { year: number; month: number } | null;
      switchToView?: string;
    }) => {
      // Cualquier mutation que termina en "view" debe limpiar el intent local
      // para que la derivacion del URL gane. El close limpia tambien.
      if (opts.closeDrawer || opts.switchToView || opts.gotoEventId !== undefined) {
        setIntent(null);
      }

      const updates: Partial<UrlState> = {};
      if (opts.gotoMonth) {
        updates.year = opts.gotoMonth.year;
        updates.month = opts.gotoMonth.month;
      }
      if (opts.gotoEventId !== undefined) {
        updates.event = opts.gotoEventId;
      } else if (opts.switchToView) {
        updates.event = opts.switchToView;
      } else if (opts.closeDrawer) {
        updates.event = null;
      }
      if (Object.keys(updates).length > 0) pushSearchParams(updates);

      router.refresh();
    },
    [pushSearchParams, router],
  );

  const monthLabel = useMemo(
    () => `${MONTH_LABELS_ES[initialMonth.month - 1]} ${initialMonth.year}`,
    [initialMonth],
  );

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Mes anterior"
              onClick={() => changeMonth(-1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span
              className="min-w-[160px] text-center text-sm font-medium"
              data-testid="month-label"
            >
              {monthLabel}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Mes siguiente"
              onClick={() => changeMonth(1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CalendarFilters value={initialFilters} onChange={applyFilters} />
            <Button onClick={() => openCreateOnDay(null)}>
              <Plus className="mr-1.5 h-4 w-4" />
              Nuevo vencimiento
            </Button>
          </div>
        </div>

        <CalendarMonthView
          month={initialMonth}
          events={initialEvents}
          onClickDay={openCreateOnDay}
          onClickEvent={openViewEvent}
        />

        <EventDrawer
          state={drawer}
          events={initialEvents}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
          currentMonth={initialMonth}
          onClose={closeDrawer}
          onSwitchToEdit={openEditEvent}
          onMutated={handleMutated}
        />
      </div>
    </TooltipProvider>
  );
}
