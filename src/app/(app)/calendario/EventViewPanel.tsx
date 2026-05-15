'use client';

import type { CalendarEventRow } from './queries';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Pencil } from 'lucide-react';

import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Separator } from '@/shared/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip';

import { civilIsoToDate } from './event-form-helpers';
import { EventStatusActions } from './EventStatusActions';
import { EVENT_STATUS_LABELS, EVENT_TIPO_LABELS, formatRecurrence } from './labels';

const FORBIDDEN_TOOLTIP = 'Solo el creador o un owner pueden modificar este vencimiento.';

type Props = {
  event: CalendarEventRow;
  currentUserId: string;
  currentUserRole: 'owner' | 'member';
  currentMonth: { year: number; month: number };
  onSwitchToEdit: (eventId: string) => void;
  onMutated: (opts: {
    closeDrawer?: boolean;
    gotoEventId?: string | null;
    gotoMonth?: { year: number; month: number } | null;
  }) => void;
};

export function EventViewPanel({
  event,
  currentUserId,
  currentUserRole,
  currentMonth,
  onSwitchToEdit,
  onMutated,
}: Props) {
  // Ajuste 4: permission gate. Mostrar disabled + tooltip si non-creator
  // non-owner. Coincide con el gate del backend (T-028 update/complete/cancel).
  const canEdit = event.created_by === currentUserId || currentUserRole === 'owner';

  // TODO(T-036): mostrar copy "auto-creado por recurrencia" cuando el next event
  // fue generado por completeCalendarEventAction. Requiere columna parent_event_id
  // o created_via_recurrence en calendar_events — heuristica sin schema no es
  // confiable (falsos positivos en eventos custom a futuro lejano).

  const fechaCivil = civilIsoToDate(event.fecha_vencimiento);
  const isOverdue =
    event.status === 'pending' && event.fecha_vencimiento < new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {EVENT_TIPO_LABELS[event.tipo as keyof typeof EVENT_TIPO_LABELS] ?? event.tipo}
            </Badge>
            <StatusBadge status={event.status} isOverdue={isOverdue} />
          </div>
          <h2 className="text-lg font-semibold tracking-tight" data-testid="event-titulo">
            {event.titulo}
          </h2>
        </div>
        {canEdit ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onSwitchToEdit(event.id)}
            data-testid="edit-trigger"
          >
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Editar
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled
                  data-testid="edit-trigger"
                >
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  Editar
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{FORBIDDEN_TOOLTIP}</TooltipContent>
          </Tooltip>
        )}
      </div>

      <Separator />

      <dl className="space-y-3 text-sm">
        <DetailRow label="Vencimiento">
          <span data-testid="event-fecha">
            {format(fechaCivil, "EEEE d 'de' LLLL yyyy", { locale: es })}
          </span>
        </DetailRow>
        <DetailRow label="Recurrencia">{formatRecurrence(event.recurrence_months)}</DetailRow>
        {event.descripcion && (
          <DetailRow label="Descripción">
            <span className="whitespace-pre-wrap text-foreground">{event.descripcion}</span>
          </DetailRow>
        )}
        <DetailRow label="Recordatorios">
          <div className="flex flex-wrap gap-1.5">
            {event.reminder_offsets_days.length === 0 ? (
              <span className="text-muted-foreground italic">Sin recordatorios.</span>
            ) : (
              event.reminder_offsets_days.map((offset) => (
                <Badge key={offset} variant="secondary" className="text-xs font-normal">
                  {offset === 0 ? 'El día' : `${offset}d antes`}
                </Badge>
              ))
            )}
          </div>
        </DetailRow>
        {event.completed_at && (
          <DetailRow label="Completado">
            {format(parseISO(event.completed_at), "d 'de' LLLL yyyy 'a las' HH:mm", { locale: es })}
          </DetailRow>
        )}
        {event.metadata &&
        typeof event.metadata === 'object' &&
        !Array.isArray(event.metadata) &&
        'cancel_reason' in event.metadata ? (
          <DetailRow label="Motivo de cancelación">
            <span className="whitespace-pre-wrap">
              {String((event.metadata as Record<string, unknown>).cancel_reason)}
            </span>
          </DetailRow>
        ) : null}
      </dl>

      {event.status === 'pending' && (
        <>
          <Separator />
          {canEdit ? (
            <EventStatusActions
              eventId={event.id}
              recurrenceMonths={event.recurrence_months}
              fechaVencimientoIso={event.fecha_vencimiento}
              currentMonth={currentMonth}
              onMutated={onMutated}
              canEdit={canEdit}
            />
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <EventStatusActions
                    eventId={event.id}
                    recurrenceMonths={event.recurrence_months}
                    fechaVencimientoIso={event.fecha_vencimiento}
                    currentMonth={currentMonth}
                    onMutated={onMutated}
                    canEdit={canEdit}
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent>{FORBIDDEN_TOOLTIP}</TooltipContent>
            </Tooltip>
          )}
        </>
      )}
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2">
      <dt className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function StatusBadge({ status, isOverdue }: { status: string; isOverdue: boolean }) {
  if (isOverdue) {
    return (
      <Badge variant="destructive" className="text-xs">
        Vencido
      </Badge>
    );
  }
  if (status === 'completed') {
    return (
      <Badge variant="default" className="bg-emerald-500 text-xs hover:bg-emerald-500/90">
        {EVENT_STATUS_LABELS.completed}
      </Badge>
    );
  }
  if (status === 'cancelled') {
    return (
      <Badge variant="secondary" className="text-xs">
        {EVENT_STATUS_LABELS.cancelled}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs">
      {EVENT_STATUS_LABELS.pending}
    </Badge>
  );
}
