'use client';

import type { CalendarEventRow, EppEventContext } from './queries';
import { useMemo } from 'react';

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/sheet';

import { EventForm } from './EventForm';
import { EventViewPanel } from './EventViewPanel';

/**
 * Modos del drawer. `view` y `edit` referencian eventos por id; `create`
 * opcionalmente lleva una fecha pre-poblada (cuando el user clickea un dia
 * vacio del grid).
 *
 * Definido aca (en lugar de en `CalendarView`) para que tanto `CalendarView`
 * (vista mensual) como `AgendaView` (T-030, vista lista) lo importen desde su
 * dueno natural sin dependencias circulares entre vistas hermanas.
 */
export type DrawerState =
  | { mode: 'closed' }
  | { mode: 'view'; eventId: string }
  | { mode: 'create'; fechaPrepop: string | null }
  | { mode: 'edit'; eventId: string };

type Props = {
  state: DrawerState;
  /** Lista de eventos del mes (no fetch adicional — el drawer lookup por id). */
  events: CalendarEventRow[];
  currentUserId: string;
  currentUserRole: 'owner' | 'member';
  currentMonth: { year: number; month: number };
  onClose: () => void;
  onSwitchToEdit: (eventId: string) => void;
  onMutated: (opts: {
    closeDrawer?: boolean;
    gotoEventId?: string | null;
    gotoMonth?: { year: number; month: number } | null;
    switchToView?: string;
  }) => void;
  /**
   * T-105: context EPP resuelto en el SC padre. Sólo lleva entries para eventos
   * `tipo='epp_entrega'` del frame visible. EventViewPanel lo consume opcional.
   */
  eppContextByEventId?: Record<string, EppEventContext>;
};

export function EventDrawer({
  state,
  events,
  currentUserId,
  currentUserRole,
  currentMonth,
  onClose,
  onSwitchToEdit,
  onMutated,
  eppContextByEventId,
}: Props) {
  const open = state.mode !== 'closed';

  // Lookup del evento si aplica (view o edit). Si no esta en la lista del mes
  // (ej: quedo stale o link share apunta a evento de otro mes), mostramos
  // fallback "no encontrado".
  const event = useMemo(() => {
    if (state.mode !== 'view' && state.mode !== 'edit') return null;
    return events.find((e) => e.id === state.eventId) ?? null;
  }, [state, events]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) onClose();
  }

  // Decidimos titulo + descripcion del Sheet segun el mode (a11y).
  const { title, description } = useMemo(() => {
    if (state.mode === 'create') {
      return {
        title: 'Nuevo vencimiento',
        description: state.fechaPrepop
          ? `Programado para el ${state.fechaPrepop}`
          : 'Datos del nuevo vencimiento',
      };
    }
    if (state.mode === 'edit') {
      return { title: 'Editar vencimiento', description: 'Modificá los datos del vencimiento' };
    }
    if (state.mode === 'view') {
      return { title: 'Detalle del vencimiento', description: 'Información del vencimiento' };
    }
    return { title: '', description: '' };
  }, [state]);

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        // overflow-y-auto critico: el form puede ser largo; sin esto el contenido
        // queda inalcanzable en mobile (Sheet shadcn no scroll por default).
        className="w-full overflow-y-auto sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle data-testid="drawer-title">{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-6">
          {state.mode === 'view' &&
            (event ? (
              <EventViewPanel
                event={event}
                currentUserId={currentUserId}
                currentUserRole={currentUserRole}
                currentMonth={currentMonth}
                onSwitchToEdit={onSwitchToEdit}
                onMutated={onMutated}
                eppContext={eppContextByEventId?.[event.id] ?? null}
              />
            ) : (
              <NotFoundView />
            ))}

          {state.mode === 'edit' &&
            (event ? (
              <EventForm
                mode="edit"
                event={event}
                currentMonth={currentMonth}
                onMutated={onMutated}
                onCancel={() => onSwitchToEdit(event.id)}
              />
            ) : (
              <NotFoundView />
            ))}

          {state.mode === 'create' && (
            <EventForm
              mode="create"
              prepopFecha={state.fechaPrepop}
              currentMonth={currentMonth}
              onMutated={onMutated}
              onCancel={onClose}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function NotFoundView() {
  return (
    <div className="text-muted-foreground py-8 text-center text-sm" data-testid="event-not-found">
      <p>Vencimiento no encontrado.</p>
      <p className="mt-1 text-xs">Puede haber sido eliminado o estás viendo un link viejo.</p>
    </div>
  );
}
