'use client';

import type { CalendarEventRow } from './queries';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { cn } from '@/shared/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/shared/ui/alert-dialog';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip';

import { completeCalendarEventAction } from './actions';
import { civilIsoToDate } from './event-form-helpers';
import { EVENT_TIPO_LABELS, formatRecurrence } from './labels';

/**
 * T-030 · Card individual de un evento en la vista agenda.
 *
 * Estructura:
 *  - Body clickeable (button) → dispara `onClickBody` (abre drawer view).
 *  - Footer con 2 botones inline: Completar (AlertDialog confirm) + Editar.
 *  - Permission gate (creator OR owner) matchea backend T-028: si false →
 *    botones disabled + tooltip "Solo el creador o un owner...".
 *
 * NO reuso EventStatusActions T-029 porque su API supone drawer (`currentMonth`,
 * recurrence-aware toast con CTA "Ver siguiente"), y agrega boton Cancel que
 * NO queremos inline en la card (evitar accidentes — para cancelar el user
 * entra al drawer).
 *
 * El toast con CTA "Ver siguiente" del flow recurrencia VIVE en este card y
 * dispara `onMutated({ gotoEventId: nextEventId })` — AgendaView interpreta
 * eso para abrir el drawer del next event automaticamente.
 */

const FORBIDDEN_TOOLTIP = 'Solo el creador o un owner pueden modificar este vencimiento.';

type Props = {
  event: CalendarEventRow;
  currentUserId: string;
  currentUserRole: 'owner' | 'member';
  onClickBody: () => void;
  onClickEdit: () => void;
  onMutated: (opts: {
    closeDrawer?: boolean;
    gotoEventId?: string | null;
    gotoMonth?: { year: number; month: number } | null;
  }) => void;
};

export function EventAgendaCard({
  event,
  currentUserId,
  currentUserRole,
  onClickBody,
  onClickEdit,
  onMutated,
}: Props) {
  const router = useRouter();
  const [completing, setCompleting] = useState(false);
  const canEdit = event.created_by === currentUserId || currentUserRole === 'owner';
  const todayIso = new Date().toISOString().slice(0, 10);
  const isOverdue = event.status === 'pending' && event.fecha_vencimiento < todayIso;
  const isToday = event.status === 'pending' && event.fecha_vencimiento === todayIso;

  const tipoLabel = EVENT_TIPO_LABELS[event.tipo as keyof typeof EVENT_TIPO_LABELS] ?? event.tipo;
  const fechaLabel = format(civilIsoToDate(event.fecha_vencimiento), "EEEE d 'de' LLLL yyyy", {
    locale: es,
  });
  const recurrenceLabel = formatRecurrence(event.recurrence_months);

  function handleErrorCode(code: string, message: string) {
    switch (code) {
      case 'ALREADY_FINAL':
        toast.error('Estado final', { description: message });
        return;
      case 'FORBIDDEN':
        toast.error('Sin permiso', { description: message });
        return;
      case 'NOT_FOUND':
        toast.error('Vencimiento no encontrado', { description: message });
        return;
      default:
        toast.error('Error inesperado', { description: message });
    }
  }

  async function onComplete() {
    setCompleting(true);
    const result = await completeCalendarEventAction(event.id);
    setCompleting(false);
    if (!result.ok) {
      handleErrorCode(result.code, result.message);
      return;
    }
    if (result.nextEventId && event.recurrence_months !== null) {
      // Mismo patron que EventStatusActions T-029 (duration: Infinity para que
      // el user tenga tiempo de clickear el CTA antes del auto-dismiss).
      toast.success('Vencimiento completado', {
        description: 'Se generó el próximo vencimiento por recurrencia.',
        duration: Infinity,
        action: {
          label: 'Ver siguiente',
          onClick: () => onMutated({ gotoEventId: result.nextEventId }),
        },
      });
    } else {
      toast.success('Vencimiento completado');
    }
    onMutated({});
    router.refresh();
  }

  return (
    <Card
      data-testid={`agenda-card-${event.id}`}
      data-status={event.status}
      className={cn(
        'gap-2 px-4 py-3',
        isOverdue && 'border-destructive/40',
        isToday && 'border-primary/40',
      )}
    >
      <button
        type="button"
        onClick={onClickBody}
        className="hover:bg-accent/30 -mx-2 -my-1 rounded-md px-2 py-1 text-left transition-colors"
        aria-label={`Ver detalle: ${event.titulo}`}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="text-xs">
            {tipoLabel}
          </Badge>
          {isOverdue && (
            <Badge variant="destructive" className="text-xs">
              Vencido
            </Badge>
          )}
          {isToday && !isOverdue && (
            <Badge className="bg-primary/15 text-primary border-primary/30 border text-xs">
              Hoy
            </Badge>
          )}
        </div>
        <h3 className="mt-1 text-sm font-semibold tracking-tight">{event.titulo}</h3>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {fechaLabel}
          {event.recurrence_months !== null && ` · ${recurrenceLabel}`}
        </p>
      </button>

      <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {canEdit ? (
          <>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" size="sm" disabled={completing} data-testid="agenda-complete">
                  {completing ? 'Completando…' : 'Completar'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Marcar como completado</AlertDialogTitle>
                  <AlertDialogDescription>
                    {event.recurrence_months !== null
                      ? `Se va a crear automáticamente el próximo vencimiento dentro de ${event.recurrence_months} meses.`
                      : 'El vencimiento queda registrado como cumplido. Esta acción no se puede deshacer.'}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void onComplete()}>Confirmar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClickEdit}
              data-testid="agenda-edit"
            >
              <Pencil className="mr-1 h-3 w-3" />
              Editar
            </Button>
          </>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex gap-2">
                <Button type="button" size="sm" disabled data-testid="agenda-complete">
                  Completar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled
                  data-testid="agenda-edit"
                >
                  <Pencil className="mr-1 h-3 w-3" />
                  Editar
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{FORBIDDEN_TOOLTIP}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </Card>
  );
}
