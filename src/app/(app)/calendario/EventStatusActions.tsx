'use client';

import type { UrlState } from './url-state';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

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
import { Button } from '@/shared/ui/button';
import { Textarea } from '@/shared/ui/textarea';

import { cancelCalendarEventAction, completeCalendarEventAction } from './actions';
import { addMonthsToYM } from './url-state';

type Props = {
  eventId: string;
  /** Para sugerir "Ver siguiente vencimiento" en el toast post-complete. */
  recurrenceMonths: number | null;
  fechaVencimientoIso: string;
  currentMonth: { year: number; month: number };
  onMutated: (opts: {
    closeDrawer?: boolean;
    gotoEventId?: string | null;
    gotoMonth?: { year: number; month: number } | null;
  }) => void;
  /** Si false, los botones se muestran disabled. */
  canEdit: boolean;
};

/**
 * T-029 · Botones Completar / Cancelar de un evento en mode view.
 *
 * Cancelar abre AlertDialog con `Textarea` opcional para reason (decision T-028
 * persiste en `metadata.cancel_reason` cuando viene). Completar abre
 * AlertDialog confirm sin input adicional.
 *
 * Recurrencia: si el complete devuelve `nextEventId !== null`, mostramos un
 * toast con CTA "Ver siguiente vencimiento" que dispara navegacion al mes del
 * nuevo evento + abre drawer view.
 */
export function EventStatusActions({
  eventId,
  recurrenceMonths,
  fechaVencimientoIso,
  currentMonth,
  onMutated,
  canEdit,
}: Props) {
  const router = useRouter();
  const [completing, setCompleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

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
    const result = await completeCalendarEventAction(eventId);
    setCompleting(false);
    if (!result.ok) {
      handleErrorCode(result.code, result.message);
      return;
    }
    // Si la recurrencia genero next event, sumamos un toast con CTA para
    // navegar al mes del nuevo vencimiento.
    if (result.nextEventId && recurrenceMonths !== null) {
      const nextYM = monthsLater(currentMonth, recurrenceMonths, fechaVencimientoIso);
      toast.success('Vencimiento completado', {
        description: 'Se generó el próximo vencimiento por recurrencia.',
        action: {
          label: 'Ver siguiente',
          onClick: () => {
            const updates: Partial<UrlState> = {
              year: nextYM.year,
              month: nextYM.month,
              event: result.nextEventId,
            };
            void updates;
            onMutated({ gotoEventId: result.nextEventId, gotoMonth: nextYM });
          },
        },
      });
    } else {
      toast.success('Vencimiento completado');
    }
    onMutated({});
    router.refresh();
  }

  async function onCancel() {
    setCancelling(true);
    const trimmed = cancelReason.trim();
    const result = await cancelCalendarEventAction(
      eventId,
      trimmed.length > 0 ? trimmed : undefined,
    );
    setCancelling(false);
    setCancelReason('');
    if (!result.ok) {
      handleErrorCode(result.code, result.message);
      return;
    }
    toast.success('Vencimiento cancelado');
    onMutated({});
    router.refresh();
  }

  return (
    <div className="flex flex-wrap gap-2">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="default"
            disabled={!canEdit || completing}
            data-testid="complete-trigger"
          >
            {completing ? 'Completando…' : 'Marcar completado'}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Marcar como completado</AlertDialogTitle>
            <AlertDialogDescription>
              {recurrenceMonths !== null
                ? `Se va a crear automáticamente el próximo vencimiento dentro de ${recurrenceMonths} meses.`
                : 'El vencimiento queda registrado como cumplido. Esta acción no se puede deshacer (podés crear un vencimiento nuevo si te confundiste).'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onComplete()}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={!canEdit || cancelling}
            className="text-destructive hover:bg-destructive/10"
            data-testid="cancel-trigger"
          >
            Cancelar vencimiento
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar vencimiento</AlertDialogTitle>
            <AlertDialogDescription>
              Los recordatorios pendientes no se van a enviar. Podés agregar un motivo (queda en el
              registro de auditoría).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value.slice(0, 500))}
            placeholder="Motivo (opcional)"
            rows={3}
            maxLength={500}
            className="my-2"
          />
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setCancelReason('')}>Volver</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onCancel()}>
              Cancelar vencimiento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Devuelve `{year, month}` del vencimiento original + N meses. Independiente
 * del mes mostrado actualmente (no necesariamente igual al currentMonth).
 */
function monthsLater(
  _current: { year: number; month: number },
  months: number,
  fromIso: string,
): { year: number; month: number } {
  const [y, m] = fromIso.split('-').map(Number) as [number, number, number];
  return addMonthsToYM({ year: y, month: m }, months);
}
