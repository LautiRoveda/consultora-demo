'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
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

import { cancelPendingSubscriptionAction } from './actions';

/**
 * T-071-FU3 · Botón "Cancelar y empezar de nuevo" para sub
 * estado='pendiente_autorizacion' (orphan abandono explícito).
 *
 * Distinto a CancelSubscriptionButton (T-072): éste borra la fila (la sub
 * nunca llegó a activa, no hay history que preservar). MP cancel best-effort
 * — 404/410 ignorables porque la preapproval puede haber expirado.
 */
export function CancelPendingButton({ suscripcionId }: { suscripcionId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onConfirm(): void {
    startTransition(async () => {
      const result = await cancelPendingSubscriptionAction(suscripcionId);
      if (result.ok) {
        toast.success('Autorización cancelada', {
          description: 'Podés iniciar una nueva suscripción cuando quieras.',
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
        case 'NOT_PENDING':
          toast.info('Estado actualizado', { description: result.message });
          setOpen(false);
          router.refresh();
          return;
        case 'FORBIDDEN_NOT_OWNER':
        case 'NOT_FOUND':
        case 'INVALID_INPUT':
        case 'NO_CONSULTORA':
        case 'MP_API_ERROR':
        case 'INTERNAL_ERROR':
          toast.error('No pudimos cancelar', { description: result.message });
          return;
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" data-testid="cancel-pending-button">
          Cancelar y empezar de nuevo
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Cancelar autorización pendiente?</AlertDialogTitle>
          <AlertDialogDescription>
            Vas a poder iniciar una nueva suscripción después. Si tu pago ya estaba aprobado en
            Mercado Pago, primero cancelalo desde el mail que recibiste.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>No, mantener</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
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
