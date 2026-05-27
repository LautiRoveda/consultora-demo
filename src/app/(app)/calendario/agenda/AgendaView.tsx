'use client';

import type { CalendarEventStatus, CalendarEventTipo } from '../defaults';
import type { DrawerState } from '../EventDrawer';
import type { CalendarEventRow, EppEventContext } from '../queries';
import type { UrlState } from '../url-state';
import { ChevronDown, Plus } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';

import { cn } from '@/shared/lib/utils';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui/collapsible';
import { TooltipProvider } from '@/shared/ui/tooltip';

import { groupEventsByBucket } from '../agenda-buckets';
import { CalendarFilters } from '../CalendarFilters';
import { EventAgendaCard } from '../EventAgendaCard';
import { EventDrawer } from '../EventDrawer';
import { buildSearchParams } from '../url-state';

/**
 * T-030 · Vista agenda lista del modulo Calendario.
 *
 * Dos modos derivados del filtro `status`:
 *  - `buckets`: filtro incluye `pending` → eventos pending agrupados en 4
 *    secciones temporales (hoy / 7d / 30d / mas adelante). Eventos
 *    completed/cancelled del filtro mixed se DROPEAN del render.
 *  - `flat`: filtro NO incluye `pending` (solo completed/cancelled) → lista
 *    plana ordenada por fecha DESC (historial reverso).
 *
 * Reusa T-029: EventDrawer, EventAgendaCard, CalendarFilters, url-state
 * (parcial — sin year/month).
 *
 * URL state: `?tipo=&status=&event=`. NO `?month=`. NO `?bucket=`.
 */

const AGENDA_PATHNAME = '/calendario/agenda';

type LocalIntent =
  | { mode: 'create'; fechaPrepop: string | null }
  | { mode: 'edit'; eventId: string }
  | null;

type Props = {
  initialEvents: CalendarEventRow[];
  initialFilters: { tipo: CalendarEventTipo[]; status: CalendarEventStatus[] };
  initialEventOpen: string | null;
  currentUserId: string;
  currentUserRole: 'owner' | 'member';
  mode: 'buckets' | 'flat';
  /** T-105: context EPP precomputado en el SC para events `tipo='epp_entrega'` del frame. */
  initialEppContextByEventId: Record<string, EppEventContext>;
};

export function AgendaView({
  initialEvents,
  initialFilters,
  initialEventOpen,
  currentUserId,
  currentUserRole,
  mode,
  initialEppContextByEventId,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [intent, setIntent] = useState<LocalIntent>(null);
  const viewEventId = searchParams.get('event') ?? initialEventOpen;

  const drawer: DrawerState = useMemo(() => {
    if (intent) return intent;
    if (viewEventId) return { mode: 'view', eventId: viewEventId };
    return { mode: 'closed' };
  }, [intent, viewEventId]);

  // `currentMonth` requerido por EventDrawer/EventForm/EventStatusActions.
  // En agenda no hay "mes mostrado". Derivamos del evento abierto (para que el
  // EventForm post-submit no decida cross-month navigation falso positivo) o
  // del today si no hay evento abierto. El `gotoMonth` callback del drawer se
  // IGNORA por `handleMutated` (decision 11 del plan T-030).
  const currentMonth = useMemo<{ year: number; month: number }>(() => {
    if (viewEventId) {
      const ev = initialEvents.find((e) => e.id === viewEventId);
      if (ev) {
        const [y, m] = ev.fecha_vencimiento.split('-').map(Number) as [number, number, number];
        return { year: y, month: m };
      }
    }
    const now = new Date();
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  }, [viewEventId, initialEvents]);

  const buckets = useMemo(() => groupEventsByBucket(initialEvents, new Date()), [initialEvents]);

  const pushSearchParams = useCallback(
    (updates: Partial<UrlState>) => {
      const current: Partial<UrlState> = {
        tipo: initialFilters.tipo,
        status: initialFilters.status,
        event: searchParams.get('event'),
      };
      const next = { ...current, ...updates };
      const qs = buildSearchParams(next);
      router.replace(qs ? `${AGENDA_PATHNAME}?${qs}` : AGENDA_PATHNAME, { scroll: false });
    },
    [initialFilters, searchParams, router],
  );

  const openCreate = useCallback(() => {
    setIntent({ mode: 'create', fechaPrepop: null });
    if (searchParams.get('event')) pushSearchParams({ event: null });
  }, [pushSearchParams, searchParams]);

  const openViewEvent = useCallback(
    (eventId: string) => {
      setIntent(null);
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

  const applyFilters = useCallback(
    (next: { tipo: CalendarEventTipo[]; status: CalendarEventStatus[] }) => {
      pushSearchParams({ tipo: next.tipo, status: next.status });
    },
    [pushSearchParams],
  );

  // En agenda IGNORAMOS `gotoMonth` (no aplica — vista sin mes). Respetamos
  // closeDrawer / gotoEventId / switchToView para que el flow recurrence "Ver
  // siguiente vencimiento" abra el drawer del next event.
  const handleMutated = useCallback(
    (opts: {
      closeDrawer?: boolean;
      gotoEventId?: string | null;
      gotoMonth?: { year: number; month: number } | null;
      switchToView?: string;
    }) => {
      if (opts.closeDrawer || opts.switchToView || opts.gotoEventId !== undefined) {
        setIntent(null);
      }
      const updates: Partial<UrlState> = {};
      if (opts.gotoEventId !== undefined) updates.event = opts.gotoEventId;
      else if (opts.switchToView) updates.event = opts.switchToView;
      else if (opts.closeDrawer) updates.event = null;
      if (Object.keys(updates).length > 0) pushSearchParams(updates);
      router.refresh();
    },
    [pushSearchParams, router],
  );

  // cardPassthrough NO incluye `onClickEdit` porque EventAgendaCard espera
  // `() => void` (sin id — el id ya esta en el closure del callback). Cada
  // card pasa su propio `onClickEdit={() => openEditEvent(ev.id)}` inline.
  const cardPassthrough = {
    currentUserId,
    currentUserRole,
    onMutated: handleMutated,
  } as const;

  const totalBucketsCount =
    buckets.hoy.length + buckets.siete.length + buckets.treinta.length + buckets.masAdelante.length;

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <CalendarFilters value={initialFilters} onChange={applyFilters} />
          <Button onClick={openCreate} data-testid="agenda-cta-new">
            <Plus className="mr-1.5 h-4 w-4" />
            Nuevo vencimiento
          </Button>
        </div>

        {mode === 'buckets' ? (
          <div className="space-y-6">
            {buckets.hoy.length > 0 && (
              <BucketSection
                title="Vencen HOY"
                count={buckets.hoy.length}
                variant="destructive"
                testId="bucket-hoy"
              >
                {buckets.hoy.map((ev) => (
                  <EventAgendaCard
                    key={ev.id}
                    event={ev}
                    onClickBody={() => openViewEvent(ev.id)}
                    onClickEdit={() => openEditEvent(ev.id)}
                    {...cardPassthrough}
                  />
                ))}
              </BucketSection>
            )}
            {buckets.siete.length > 0 && (
              <BucketSection
                title="Vencen en 7 días"
                count={buckets.siete.length}
                variant="primary"
                testId="bucket-siete"
              >
                {buckets.siete.map((ev) => (
                  <EventAgendaCard
                    key={ev.id}
                    event={ev}
                    onClickBody={() => openViewEvent(ev.id)}
                    onClickEdit={() => openEditEvent(ev.id)}
                    {...cardPassthrough}
                  />
                ))}
              </BucketSection>
            )}
            {buckets.treinta.length > 0 && (
              <BucketSection
                title="Vencen en 30 días"
                count={buckets.treinta.length}
                variant="muted"
                testId="bucket-treinta"
              >
                {buckets.treinta.map((ev) => (
                  <EventAgendaCard
                    key={ev.id}
                    event={ev}
                    onClickBody={() => openViewEvent(ev.id)}
                    onClickEdit={() => openEditEvent(ev.id)}
                    {...cardPassthrough}
                  />
                ))}
              </BucketSection>
            )}
            {buckets.masAdelante.length > 0 && (
              <BucketSection
                title="Más adelante"
                count={buckets.masAdelante.length}
                variant="muted"
                collapsible
                defaultOpen={false}
                testId="bucket-mas-adelante"
              >
                {buckets.masAdelante.map((ev) => (
                  <EventAgendaCard
                    key={ev.id}
                    event={ev}
                    onClickBody={() => openViewEvent(ev.id)}
                    onClickEdit={() => openEditEvent(ev.id)}
                    {...cardPassthrough}
                  />
                ))}
              </BucketSection>
            )}

            {totalBucketsCount === 0 && <EmptyState onClickCreate={openCreate} />}
          </div>
        ) : (
          <FlatList
            events={initialEvents}
            onClickBody={openViewEvent}
            onClickEdit={openEditEvent}
            cardPassthrough={cardPassthrough}
          />
        )}

        <EventDrawer
          state={drawer}
          events={initialEvents}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
          currentMonth={currentMonth}
          onClose={closeDrawer}
          onSwitchToEdit={openEditEvent}
          onMutated={handleMutated}
          eppContextByEventId={initialEppContextByEventId}
        />
      </div>
    </TooltipProvider>
  );
}

type BucketVariant = 'destructive' | 'primary' | 'muted';

function BucketSection({
  title,
  count,
  variant,
  children,
  collapsible = false,
  defaultOpen = true,
  testId,
}: {
  title: string;
  count: number;
  variant: BucketVariant;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  testId?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const badgeClasses = cn(
    'text-xs',
    variant === 'destructive' && 'bg-destructive/15 text-destructive border-destructive/30 border',
    variant === 'primary' && 'bg-primary/15 text-primary border-primary/30 border',
    variant === 'muted' && 'bg-muted text-muted-foreground border-border border',
  );

  if (collapsible) {
    return (
      <Collapsible open={open} onOpenChange={setOpen} data-testid={testId}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="hover:bg-accent/30 -mx-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left"
          >
            <ChevronDown
              className={cn('h-4 w-4 transition-transform', !open && '-rotate-90')}
              aria-hidden="true"
            />
            <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
            <Badge className={badgeClasses}>{count}</Badge>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 space-y-2">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <section data-testid={testId} className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        <Badge className={badgeClasses}>{count}</Badge>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function EmptyState({ onClickCreate }: { onClickCreate: () => void }) {
  return (
    <Card className="items-center gap-3 p-8 text-center" data-testid="agenda-empty">
      <p className="text-sm font-medium">No hay vencimientos pendientes.</p>
      <p className="text-muted-foreground text-xs">
        Cuando crees un vencimiento, va a aparecer acá según su fecha.
      </p>
      <Button onClick={onClickCreate} size="sm">
        <Plus className="mr-1.5 h-4 w-4" />
        Crear vencimiento
      </Button>
    </Card>
  );
}

function FlatList({
  events,
  onClickBody,
  onClickEdit,
  cardPassthrough,
}: {
  events: CalendarEventRow[];
  onClickBody: (eventId: string) => void;
  onClickEdit: (eventId: string) => void;
  cardPassthrough: {
    currentUserId: string;
    currentUserRole: 'owner' | 'member';
    onMutated: (opts: {
      closeDrawer?: boolean;
      gotoEventId?: string | null;
      gotoMonth?: { year: number; month: number } | null;
    }) => void;
  };
}) {
  if (events.length === 0) {
    return (
      <Card className="p-8 text-center" data-testid="agenda-empty-flat">
        <p className="text-muted-foreground text-sm">No hay eventos con los filtros aplicados.</p>
      </Card>
    );
  }
  return (
    <div className="space-y-2" data-testid="agenda-flat-list">
      {events.map((ev) => (
        <EventAgendaCard
          key={ev.id}
          event={ev}
          onClickBody={() => onClickBody(ev.id)}
          onClickEdit={() => onClickEdit(ev.id)}
          {...cardPassthrough}
        />
      ))}
    </div>
  );
}
