'use client';

import { Rocket } from 'lucide-react';
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

import { publishVersionAction } from '../actions';
import { handleCommonFailure } from './feedback';

interface Props {
  versionId: string;
  itemCount: number;
}

/**
 * Publica el borrador (lo congela como versión inmutable). Disabled si no hay ítems
 * (el server revalida con VERSION_EMPTY igual). Confirma antes — publicar es
 * irreversible: para volver a editar hay que clonar a un nuevo borrador.
 */
export function PublishButton({ versionId, itemCount }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const noItems = itemCount === 0;

  function handlePublish() {
    setOpen(false);
    startTransition(async () => {
      const result = await publishVersionAction({ versionId });
      if (result.ok) {
        toast.success('Versión publicada');
        router.refresh();
        return;
      }
      handleCommonFailure(result, router);
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          disabled={isPending || noItems}
          title={noItems ? 'Agregá al menos un ítem para publicar' : undefined}
        >
          <Rocket className="mr-2 size-4" aria-hidden />
          {isPending ? 'Publicando…' : 'Publicar'}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Publicar esta versión?</AlertDialogTitle>
          <AlertDialogDescription>
            La versión queda congelada y lista para ejecutar. Para hacer más cambios vas a tener que
            crear un borrador nuevo desde la versión publicada.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={handlePublish} disabled={isPending}>
            Publicar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
