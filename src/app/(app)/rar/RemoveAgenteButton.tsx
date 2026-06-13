'use client';

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

import { removeAgenteDePuestoAction } from './actions';

interface Props {
  clienteId: string;
  puestoId: string;
  agenteId: string;
  agenteNombre: string;
}

export function RemoveAgenteButton({ clienteId, puestoId, agenteId, agenteNombre }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  function handleConfirm() {
    setOpen(false);
    startTransition(async () => {
      const result = await removeAgenteDePuestoAction({
        cliente_id: clienteId,
        puesto_id: puestoId,
        agente_id: agenteId,
      });

      if (result.ok) {
        toast.success('Agente quitado');
        router.refresh();
        return;
      }

      switch (result.code) {
        case 'NOT_FOUND':
          toast.info('La asignación ya no existía');
          router.refresh();
          return;
        case 'UNAUTHENTICATED':
          toast.error('Sesión vencida', { description: result.message });
          router.push('/login');
          return;
        case 'NO_CONSULTORA':
          toast.error('Cuenta sin consultora', { description: result.message });
          return;
        case 'INVALID_INPUT':
          toast.error('Datos inválidos', { description: result.message });
          return;
        default:
          toast.error('No se pudo quitar el agente', { description: result.message });
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !isPending && setOpen(next)}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={isPending} className="shrink-0">
          Quitar
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Quitar «{agenteNombre}»?</AlertDialogTitle>
          <AlertDialogDescription>
            Se eliminará la exposición a <strong>{agenteNombre}</strong> de este puesto. La
            auditoría conserva el registro y podés re-asignarlo después.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={isPending}>
            Quitar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
