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
import { Label } from '@/shared/ui/label';
import { Textarea } from '@/shared/ui/textarea';

import { anularEjecucionAction } from './actions';

const MOTIVO_MIN = 5;
const MOTIVO_MAX = 2000;

/**
 * T-061b · Acción Anular del detalle (owner + vigente). Molde
 * IncidenteActionsButtons: AlertDialog con `motivo` OBLIGATORIO (5–2000, decisión
 * owner) en estado controlado (evita quirks de form-in-dialog con el focus-trap
 * de Radix). El backend cascada CAPAs + eventos + reminders y crea el tombstone.
 */
export function EjecucionDetailActions({ executionId }: { executionId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [motivo, setMotivo] = useState('');

  const motivoTrim = motivo.trim();
  const motivoValid = motivoTrim.length >= MOTIVO_MIN && motivoTrim.length <= MOTIVO_MAX;

  function handleAnular() {
    if (!motivoValid) return;
    startTransition(async () => {
      const result = await anularEjecucionAction({ executionId, motivo: motivoTrim });

      if (result.ok) {
        toast.success('Inspección anulada');
        setDialogOpen(false);
        router.refresh();
        return;
      }

      switch (result.code) {
        case 'ALREADY_ANULLED':
          toast.info('Esta inspección ya estaba anulada');
          setDialogOpen(false);
          router.refresh();
          return;
        case 'NOT_FOUND':
          toast.error('Inspección no encontrada');
          router.push('/checklists/ejecuciones');
          return;
        case 'INVALID_INPUT':
          toast.error('Motivo inválido', { description: result.message });
          return;
        case 'BILLING_GATED':
          toast.error('Plan expirado', {
            description: result.message,
            action: { label: 'Suscribirme', onClick: () => router.push('/settings/billing') },
          });
          return;
        case 'FORBIDDEN_NOT_OWNER':
          toast.error('Acción reservada al titular', { description: result.message });
          return;
        case 'UNAUTHENTICATED':
          toast.error('Sesión vencida', { description: result.message });
          router.push('/login');
          return;
        case 'NO_CONSULTORA':
        case 'INTERNAL_ERROR':
        default:
          toast.error('No se pudo anular', { description: result.message });
          return;
      }
    });
  }

  return (
    <AlertDialog
      open={dialogOpen}
      onOpenChange={(open) => {
        setDialogOpen(open);
        if (!open) setMotivo('');
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={isPending}>
          Anular
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Anular esta inspección?</AlertDialogTitle>
          <AlertDialogDescription>
            La anulación es definitiva: se cancelan sus acciones correctivas y los recordatorios del
            calendario. Indicá el motivo (queda en el historial).
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="motivo-anulacion">Motivo de la anulación</Label>
          <Textarea
            id="motivo-anulacion"
            rows={3}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={MOTIVO_MAX}
            placeholder="Ej: cargada por error, duplicada de otra inspección…"
            disabled={isPending}
            aria-invalid={motivo.length > 0 && !motivoValid}
          />
          {motivo.length > 0 && !motivoValid && (
            <p className="text-destructive text-xs">
              El motivo debe tener entre {MOTIVO_MIN} y {MOTIVO_MAX} caracteres.
            </p>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleAnular();
            }}
            disabled={isPending || !motivoValid}
          >
            Anular inspección
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
