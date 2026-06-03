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

import { archiveTemplateAction, restoreTemplateAction } from './actions';

interface Props {
  templateId: string;
  nombre: string;
  archived: boolean;
}

/**
 * Archivar / Restaurar un template propio con confirmación. Restaurar puede chocar
 * el índice parcial de nombre (DUPLICATE_NAME) si el nombre se reusó mientras estaba
 * archivado → lo avisamos sin cerrar para que el owner renombre primero.
 */
export function TemplateArchiveButton({ templateId, nombre, archived }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const verb = archived ? 'Restaurar' : 'Archivar';

  function handleConfirm() {
    setOpen(false);
    startTransition(async () => {
      const result = archived
        ? await restoreTemplateAction({ templateId })
        : await archiveTemplateAction({ templateId });

      if (result.ok) {
        toast.success(archived ? 'Template restaurado' : 'Template archivado');
        router.refresh();
        return;
      }

      switch (result.code) {
        case 'ALREADY_ARCHIVED':
          toast.info('El template ya estaba archivado');
          router.refresh();
          return;
        case 'ALREADY_ACTIVE':
          toast.info('El template ya estaba activo');
          router.refresh();
          return;
        case 'DUPLICATE_NAME':
          toast.error('No se pudo restaurar', { description: result.message });
          return;
        case 'FORBIDDEN_NOT_OWNER':
          toast.error('Permisos insuficientes', { description: result.message });
          return;
        case 'NOT_FOUND':
          toast.error('Template no encontrado');
          router.refresh();
          return;
        case 'BILLING_GATED':
          toast.error('Suscripción requerida', { description: result.message });
          return;
        case 'UNAUTHENTICATED':
          toast.error('Sesión vencida', { description: result.message });
          router.push('/login');
          return;
        default:
          toast.error('Error inesperado', { description: result.message });
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant={archived ? 'default' : 'outline'} size="sm" disabled={isPending}>
          {verb}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            ¿{verb} «{nombre}»?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {archived
              ? 'El template va a volver a aparecer en la lista activa y a estar disponible para usar.'
              : 'El template se va a ocultar de la lista activa. Podés restaurarlo cuando quieras.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={isPending}>
            {verb}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
