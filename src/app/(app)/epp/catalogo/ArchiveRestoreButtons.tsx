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

import {
  archiveCategoriaAction,
  archiveItemAction,
  archivePuestoAction,
  restoreCategoriaAction,
  restoreItemAction,
  restorePuestoAction,
} from './actions';

type Entity = 'categoria' | 'item' | 'puesto';

const ARCHIVE: Record<
  Entity,
  (id: string) => Promise<{ ok: boolean; code?: string; message?: string }>
> = {
  categoria: archiveCategoriaAction,
  item: archiveItemAction,
  puesto: archivePuestoAction,
};

const RESTORE: Record<
  Entity,
  (id: string) => Promise<{ ok: boolean; code?: string; message?: string }>
> = {
  categoria: restoreCategoriaAction,
  item: restoreItemAction,
  puesto: restorePuestoAction,
};

const LABEL: Record<Entity, { singular: string; editPath: (id: string) => string }> = {
  categoria: {
    singular: 'Categoría',
    editPath: (id) => `/epp/catalogo/categorias/${id}/editar`,
  },
  item: {
    singular: 'Item',
    editPath: (id) => `/epp/catalogo/items/${id}/editar`,
  },
  puesto: {
    singular: 'Puesto',
    editPath: (id) => `/epp/catalogo/puestos/${id}/editar`,
  },
};

interface Props {
  entity: Entity;
  id: string;
  nombre: string;
  archived: boolean;
}

export function ArchiveRestoreButtons({ entity, id, nombre, archived }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const label = LABEL[entity];
  const isFem = entity === 'categoria';
  const yaArt = isFem ? 'la' : 'el';
  const yaSuf = isFem ? 'da' : 'do';

  function handleToggle() {
    setDialogOpen(false);
    startTransition(async () => {
      const result = archived ? await RESTORE[entity](id) : await ARCHIVE[entity](id);

      if (result.ok) {
        toast.success(
          archived
            ? `${label.singular} ${isFem ? 'restaurada' : 'restaurado'}`
            : `${label.singular} ${isFem ? 'archivada' : 'archivado'}`,
        );
        router.refresh();
        return;
      }

      switch (result.code) {
        case 'ALREADY_ARCHIVED':
          toast.info(`${label.singular} ya estaba ${isFem ? 'archivada' : 'archivado'}`);
          router.refresh();
          return;
        case 'ALREADY_ACTIVE':
          toast.info(`${label.singular} ya estaba ${isFem ? 'activa' : 'activo'}`);
          router.refresh();
          return;
        case 'DUPLICATE_NAME':
          toast.error(`No podés restaurar ${yaArt} ${label.singular.toLowerCase()}`, {
            description:
              result.message ??
              `Existe otra ${label.singular.toLowerCase()} activa con el mismo nombre.`,
          });
          return;
        case 'FORBIDDEN_NOT_OWNER':
          toast.error('Permisos insuficientes', {
            description: result.message ?? 'Solo el owner puede editar el catálogo EPP.',
          });
          return;
        case 'NOT_FOUND':
          toast.error(`${label.singular} no ${isFem ? 'encontrada' : 'encontrado'}`);
          router.refresh();
          return;
        case 'UNAUTHENTICATED':
          toast.error('Sesión vencida', { description: result.message ?? '' });
          router.push('/login');
          return;
        default:
          toast.error('Error inesperado', { description: result.message ?? '' });
      }
    });
  }

  const verb = archived ? (isFem ? 'Restaurar' : 'Restaurar') : isFem ? 'Archivar' : 'Archivar';
  const verbPast = isFem
    ? archived
      ? 'restaurar'
      : 'archivar'
    : archived
      ? 'restaurar'
      : 'archivar';

  return (
    <div className="flex shrink-0 gap-2">
      <Button asChild variant="outline" size="sm">
        <Link href={label.editPath(id)}>Editar</Link>
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
                ? `${label.singular} va a volver a aparecer en la lista activa y a estar disponible para usar.`
                : `${label.singular} se va a ocultar de la lista activa. Podés ${verbPast} ${yaArt} ${label.singular.toLowerCase()} cuando quieras${yaSuf === 'do' ? '' : ''}.`}
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
