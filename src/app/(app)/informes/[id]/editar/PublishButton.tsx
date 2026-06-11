'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { mapInformeTipoToEventoConfig } from '@/shared/templates/informe-to-event';
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/ui/tooltip';

import { publishInformeAction, unpublishInformeAction } from '../../actions';
import { type InformeStatus, type InformeTipo } from '../../schema';

/**
 * T-036 · Botón Publicar / Volver a borrador.
 *
 * Mostra:
 *  - status='draft'   -> "Publicar" (variant default).
 *  - status='published' -> "Volver a borrador" (variant outline).
 *  - status='archived'  -> oculto.
 *
 * Permission gate: si `canPublish=false` -> botón disabled + Tooltip
 * "Solo el creador o un owner pueden publicar".
 *
 * Trigger del modal post-publish: si toggle OFF + tipo recurrente + no hay
 * evento vinculado + publish OK + autoCreatedEventId null → llama al callback
 * `onPostPublishModalRequested` del parent (que abre PostPublishEventDialog).
 *
 * Si autoCreatedEventId != null (silent path), muestra toast con CTA
 * "Ver vencimiento" → link a /calendario/agenda?event=<uuid>.
 */
export type PublishButtonProps = {
  informeId: string;
  status: InformeStatus;
  informeTipo: InformeTipo;
  canPublish: boolean;
  autoCreateEventOnSign: boolean;
  hasLinkedEvent: boolean;
  /**
   * Si las condiciones del modal path se cumplen tras publish OK, este
   * callback se invoca para que el parent abra `PostPublishEventDialog`.
   * Si no se pasa, el modal nunca aparece (PublishButton emite solo toast).
   */
  onPostPublishModalRequested?: () => void;
  /**
   * T-141 Fase C · Se ejecuta ANTES de publicar: el parent persiste la última
   * edición autoguardada (flush + draft-save, esperando un autosave en vuelo).
   * Si devuelve false, el guardado previo falló → se aborta el publish para no
   * firmar sobre una versión stale.
   */
  onBeforePublish?: () => Promise<boolean>;
};

export function PublishButton({
  informeId,
  status,
  informeTipo,
  canPublish,
  autoCreateEventOnSign,
  hasLinkedEvent,
  onPostPublishModalRequested,
  onBeforePublish,
}: PublishButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [publishOpen, setPublishOpen] = useState(false);
  const [unpublishOpen, setUnpublishOpen] = useState(false);

  if (status === 'archived') {
    return null;
  }

  function handleApiError(
    result: Extract<
      | Awaited<ReturnType<typeof publishInformeAction>>
      | Awaited<ReturnType<typeof unpublishInformeAction>>,
      { ok: false }
    >,
  ) {
    switch (result.code) {
      case 'INVALID_INPUT':
        toast.error('Datos inválidos', { description: result.message });
        return;
      case 'UNAUTHENTICATED':
        toast.error('Sesión vencida', { description: result.message });
        router.push('/login');
        return;
      case 'NO_CONSULTORA':
        toast.error('Cuenta sin consultora', { description: result.message });
        return;
      case 'NOT_FOUND':
        toast.error('Informe no encontrado', { description: result.message });
        return;
      case 'FORBIDDEN':
        toast.error('Sin permiso', { description: result.message });
        return;
      case 'EMPTY_CONTENT':
        toast.error('Falta contenido', { description: result.message });
        return;
      case 'INTERNAL_ERROR':
        toast.error('Error', { description: result.message });
        return;
    }
  }

  function onConfirmPublish() {
    setPublishOpen(false);
    startTransition(async () => {
      // T-141 Fase C · Persistir la última edición autoguardada antes de publicar.
      // Si falla, abortar: el publicado debe ser la última versión, no una stale.
      if (onBeforePublish) {
        const ready = await onBeforePublish();
        if (!ready) {
          toast.error('No se pudo guardar el borrador', {
            description: 'Revisá tu conexión y reintentá antes de publicar.',
          });
          return;
        }
      }

      const result = await publishInformeAction(informeId);
      if (!result.ok) {
        handleApiError(result);
        return;
      }

      // Silent path: evento auto-creado. Toast con CTA "Ver vencimiento".
      if (result.autoCreatedEventId) {
        toast.success('Informe publicado', {
          description: 'Se creó el vencimiento del próximo año.',
          action: {
            label: 'Ver vencimiento',
            onClick: () => {
              router.push(`/calendario/agenda?event=${result.autoCreatedEventId}`);
            },
          },
        });
        router.refresh();
        return;
      }

      // Modal path: tipo recurrente + toggle OFF + sin evento previo.
      const config = mapInformeTipoToEventoConfig(informeTipo);
      const shouldOpenModal =
        !autoCreateEventOnSign && config !== null && !hasLinkedEvent && onPostPublishModalRequested;
      if (shouldOpenModal) {
        toast.success('Informe publicado');
        onPostPublishModalRequested();
        router.refresh();
        return;
      }

      // Default: tipo no recurrente, o ya hay evento, o toggle ON pero el
      // silent path no aplicó por algún motivo. Toast simple.
      toast.success('Informe publicado');
      router.refresh();
    });
  }

  function onConfirmUnpublish() {
    setUnpublishOpen(false);
    startTransition(async () => {
      const result = await unpublishInformeAction(informeId);
      if (!result.ok) {
        handleApiError(result);
        return;
      }
      toast.success('Informe vuelto a borrador');
      router.refresh();
    });
  }

  if (status === 'draft') {
    const button = (
      <Button type="button" disabled={!canPublish || isPending}>
        Publicar
      </Button>
    );

    if (!canPublish) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>{button}</span>
            </TooltipTrigger>
            <TooltipContent>Solo el creador o un owner pueden publicar</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return (
      <AlertDialog open={publishOpen} onOpenChange={setPublishOpen}>
        <AlertDialogTrigger asChild>{button}</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Publicar el informe?</AlertDialogTitle>
            <AlertDialogDescription>
              Una vez publicado, el contenido queda como referencia oficial. Podés volver a borrador
              después si necesitás editarlo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmPublish}>Publicar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  // status === 'published'
  const unpublishButton = (
    <Button type="button" variant="outline" disabled={!canPublish || isPending}>
      Volver a borrador
    </Button>
  );

  if (!canPublish) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>{unpublishButton}</span>
          </TooltipTrigger>
          <TooltipContent>Solo el creador o un owner pueden modificar el informe</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground text-xs font-medium">Publicado</span>
      <Link
        href={`/calendario/agenda`}
        className="text-muted-foreground hover:text-foreground text-xs underline"
      >
        Ver calendario
      </Link>
      <AlertDialog open={unpublishOpen} onOpenChange={setUnpublishOpen}>
        <AlertDialogTrigger asChild>{unpublishButton}</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Volver a borrador?</AlertDialogTitle>
            <AlertDialogDescription>
              Vas a poder editar el contenido y publicarlo de nuevo. Los vencimientos vinculados (si
              los hay) NO se borran automáticamente — borralos manualmente desde el calendario si
              querés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmUnpublish}>Volver a borrador</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
