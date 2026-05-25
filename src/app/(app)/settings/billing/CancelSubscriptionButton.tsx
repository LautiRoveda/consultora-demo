'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { formatDateAR } from '@/shared/lib/format-date';
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

import { cancelSubscriptionAction } from './actions';

/**
 * T-072 · Botón "Cancelar suscripción" con confirmación.
 *
 * AlertDialog para evitar el self-fire accidental. La action setea
 * `cancelar_en = now` — el webhook `subscription_preapproval` con status
 * cancelled materializa `cancelada_en` + `estado='cancelada'`. Mientras
 * tanto el user mantiene acceso hasta el final del período pagado.
 */
export function CancelSubscriptionButton({
  suscripcionId,
  periodoFin,
}: {
  suscripcionId: string;
  periodoFin: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onConfirm(): void {
    startTransition(async () => {
      const result = await cancelSubscriptionAction(suscripcionId);
      if (result.ok) {
        toast.success('Suscripción cancelada', {
          description:
            'Mantenés acceso hasta el final del período pagado. Te confirmamos la baja por email.',
        });
        setOpen(false);
        router.refresh();
        return;
      }
      switch (result.code) {
        case 'UNAUTHENTICATED':
          toast.error('Sesión vencida', { description: result.message });
          router.push('/login');
          return;
        case 'FORBIDDEN_NOT_OWNER':
        case 'NOT_FOUND':
        case 'NOT_CANCELABLE':
        case 'INVALID_INPUT':
        case 'NO_CONSULTORA':
        case 'MP_API_ERROR':
        case 'INTERNAL_ERROR':
          toast.error('No pudimos cancelar', { description: result.message });
          return;
      }
    });
  }

  const fechaCorte = new Date(periodoFin);
  const fechaCorteStr = Number.isNaN(fechaCorte.getTime()) ? periodoFin : formatDateAR(fechaCorte);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" data-testid="cancel-subscription-button">
          Cancelar suscripción
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Cancelar suscripción?</AlertDialogTitle>
          <AlertDialogDescription>
            Vas a perder acceso a las features pagas el <strong>{fechaCorteStr}</strong>. Hasta esa
            fecha mantenés todo igual.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>No, mantener</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // Evita el close automático del Action: queremos cerrar solo
              // si la action devuelve ok=true (manejado en `onConfirm`).
              e.preventDefault();
              onConfirm();
            }}
            disabled={pending}
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Sí, cancelar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
