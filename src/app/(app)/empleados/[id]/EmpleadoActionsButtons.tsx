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

import { archiveEmpleadoAction, unarchiveEmpleadoAction } from '../actions';

interface Props {
  empleadoId: string;
  fullName: string;
  archived: boolean;
}

/**
 * Botones del detail view. Permission gate any-member (matchea RLS T-053 —
 * empleados son data compartida del tenant). DUPLICATE_DNI en unarchive
 * muestra el mensaje completo del action (que explica el edge case).
 */
export function EmpleadoActionsButtons({ empleadoId, fullName, archived }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);

  function handleToggle() {
    setDialogOpen(false);
    startTransition(async () => {
      const result = archived
        ? await unarchiveEmpleadoAction(empleadoId)
        : await archiveEmpleadoAction(empleadoId);

      if (result.ok) {
        toast.success(archived ? 'Empleado desarchivado' : 'Empleado archivado');
        router.refresh();
        return;
      }

      switch (result.code) {
        case 'ALREADY_ARCHIVED':
          toast.info('El empleado ya estaba archivado');
          router.refresh();
          return;
        case 'ALREADY_ACTIVE':
          toast.info('El empleado ya estaba activo');
          router.refresh();
          return;
        case 'DUPLICATE_DNI':
          toast.error('No podés desarchivar', {
            description: result.message,
          });
          return;
        case 'NOT_FOUND':
          toast.error('Empleado no encontrado');
          router.push('/empleados');
          return;
        case 'UNAUTHENTICATED':
          toast.error('Sesión vencida', { description: result.message });
          router.push('/login');
          return;
        case 'NO_CONSULTORA':
          toast.error('Cuenta sin consultora', { description: result.message });
          return;
        default:
          toast.error('Error inesperado', { description: result.message });
      }
    });
  }

  return (
    <div className="flex shrink-0 gap-2">
      <Button asChild variant="outline">
        <Link href={`/empleados/${empleadoId}/editar`}>Editar</Link>
      </Button>
      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogTrigger asChild>
          <Button variant={archived ? 'default' : 'outline'} disabled={isPending}>
            {archived ? 'Desarchivar' : 'Archivar'}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {archived ? `¿Desarchivar a ${fullName}?` : `¿Archivar a ${fullName}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {archived
                ? 'El empleado volverá a aparecer en la lista activa.'
                : 'Se ocultará de la lista activa. Podés desarchivarlo después.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleToggle} disabled={isPending}>
              {archived ? 'Desarchivar' : 'Archivar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
