'use client';

import { Trash2 } from 'lucide-react';
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

import { handleCommonFailure } from './feedback';

interface Props {
  /** Qué se borra, para el título: «esta sección» / «este ítem». */
  entityLabel: string;
  /** Nombre/título del elemento (se muestra entre comillas). */
  name: string;
  ariaLabel: string;
  onDelete: () => Promise<{ ok: boolean; code?: string; message?: string }>;
}

export function ConfirmDeleteButton({ entityLabel, name, ariaLabel, onDelete }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    setOpen(false);
    startTransition(async () => {
      const result = await onDelete();
      if (result.ok) {
        toast.success('Eliminado');
        router.refresh();
        return;
      }
      handleCommonFailure(result as { ok: false; code: string; message?: string }, router);
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-destructive"
          disabled={isPending}
          aria-label={ariaLabel}
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar {entityLabel}?</AlertDialogTitle>
          <AlertDialogDescription>
            «{name}» se va a borrar del borrador. Esta acción no se puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={isPending}>
            Eliminar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
