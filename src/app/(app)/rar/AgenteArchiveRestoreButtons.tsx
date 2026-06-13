'use client';

import Link from 'next/link';
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

import { archiveAgenteAction, restoreAgenteAction } from './actions';

interface Props {
  id: string;
  nombre: string;
  archived: boolean;
}

export function AgenteArchiveRestoreButtons({ id, nombre, archived }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);

  function handleToggle() {
    setDialogOpen(false);
    startTransition(async () => {
      const result = archived ? await restoreAgenteAction(id) : await archiveAgenteAction(id);

      if (result.ok) {
        toast.success(archived ? 'Agente restaurado' : 'Agente archivado');
        router.refresh();
        return;
      }

      switch (result.code) {
        case 'ALREADY_ARCHIVED':
          toast.info('El agente ya estaba archivado');
          router.refresh();
          return;
        case 'ALREADY_ACTIVE':
          toast.info('El agente ya estaba activo');
          router.refresh();
          return;
        case 'DUPLICATE':
          toast.error('No podés restaurar el agente', { description: result.message });
          return;
        case 'FORBIDDEN_NOT_OWNER':
          toast.error('Permisos insuficientes', { description: result.message });
          return;
        case 'NOT_FOUND':
          toast.error('Agente no encontrado');
          router.refresh();
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

  const verb = archived ? 'Restaurar' : 'Archivar';

  return (
    <div className="flex shrink-0 gap-2">
      <Button asChild variant="outline" size="sm">
        <Link href={`/rar/agentes/${id}/editar`}>Editar</Link>
      </Button>
      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogTrigger asChild>
          <Button variant={archived ? 'default' : 'outline'} size="sm" disabled={isPending}>
            {verb}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿{verb} {`«${nombre}»`}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {archived
                ? 'El agente va a volver a la lista activa y a estar disponible para asignar a puestos.'
                : 'El agente se va a ocultar de la lista activa. Podés restaurarlo cuando quieras. Las exposiciones ya asignadas no se borran.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleToggle} disabled={isPending}>
              {verb}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
