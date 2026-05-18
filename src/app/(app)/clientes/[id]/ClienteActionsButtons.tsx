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

import { archiveClienteAction, unarchiveClienteAction } from '../actions';

interface Props {
  clienteId: string;
  razonSocial: string;
  archived: boolean;
}

/**
 * Botones de acción del detail view. Permission gate any-member (matchea RLS
 * T-047/T-048 — clientes son data compartida del tenant). NO disabled por
 * ownership.
 */
export function ClienteActionsButtons({ clienteId, razonSocial, archived }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);

  function handleToggle() {
    setDialogOpen(false);
    startTransition(async () => {
      const result = archived
        ? await unarchiveClienteAction(clienteId)
        : await archiveClienteAction(clienteId);

      if (result.ok) {
        toast.success(archived ? 'Cliente desarchivado' : 'Cliente archivado');
        router.refresh();
        return;
      }

      switch (result.code) {
        case 'ALREADY_ARCHIVED':
          toast.info('El cliente ya estaba archivado');
          router.refresh();
          return;
        case 'ALREADY_ACTIVE':
          toast.info('El cliente ya estaba activo');
          router.refresh();
          return;
        case 'DUPLICATE_CUIT':
          toast.error('No podés desarchivar', {
            description: 'Existe otro cliente activo con este CUIT. Archivá el otro primero.',
          });
          return;
        case 'NOT_FOUND':
          toast.error('Cliente no encontrado');
          router.push('/clientes');
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
        <Link href={`/clientes/${clienteId}/editar`}>Editar</Link>
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
              {archived ? `¿Desarchivar a ${razonSocial}?` : `¿Archivar a ${razonSocial}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {archived
                ? 'El cliente volverá a aparecer en la lista activa.'
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
