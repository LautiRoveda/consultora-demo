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

import { resolverCapaAction } from './actions';

const EVIDENCIA_MIN = 5;
const EVIDENCIA_MAX = 2000;

/**
 * T-120 · "Marcar resuelta" del detalle de inspección (member + CAPA no-final +
 * ejecución vigente; el gating vive en EjecucionDetailView). Molde
 * EjecucionDetailActions: AlertDialog con `evidencia` OBLIGATORIA (5–2000) en estado
 * controlado (evita quirks de form-in-dialog con el focus-trap de Radix). El backend
 * cierra la CAPA + completa su evento de calendario y skip reminders.
 */
export function CapaResolverButton({ capaId }: { capaId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [evidencia, setEvidencia] = useState('');

  const evidenciaTrim = evidencia.trim();
  const evidenciaValid =
    evidenciaTrim.length >= EVIDENCIA_MIN && evidenciaTrim.length <= EVIDENCIA_MAX;

  function handleResolver() {
    if (!evidenciaValid) return;
    startTransition(async () => {
      const result = await resolverCapaAction({ capaId, evidencia_cierre: evidenciaTrim });

      if (result.ok) {
        if (result.calendarWarning) toast.warning(result.calendarWarning);
        else toast.success('Acción correctiva resuelta');
        setDialogOpen(false);
        router.refresh();
        return;
      }

      switch (result.code) {
        case 'ALREADY_CLOSED':
          toast.info('La acción correctiva ya estaba cerrada o anulada');
          setDialogOpen(false);
          router.refresh();
          return;
        case 'NOT_FOUND':
          toast.error('Acción correctiva no encontrada');
          router.refresh();
          return;
        case 'INVALID_INPUT':
          toast.error('Evidencia inválida', { description: result.message });
          return;
        case 'BILLING_GATED':
          toast.error('Plan expirado', {
            description: result.message,
            action: { label: 'Suscribirme', onClick: () => router.push('/settings/billing') },
          });
          return;
        case 'UNAUTHENTICATED':
          toast.error('Sesión vencida', { description: result.message });
          router.push('/login');
          return;
        case 'NO_CONSULTORA':
        case 'FORBIDDEN_NOT_OWNER':
        case 'INTERNAL_ERROR':
        default:
          toast.error('No se pudo resolver', { description: result.message });
          return;
      }
    });
  }

  return (
    <AlertDialog
      open={dialogOpen}
      onOpenChange={(open) => {
        setDialogOpen(open);
        if (!open) setEvidencia('');
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={isPending}>
          Marcar resuelta
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Marcar esta acción correctiva como resuelta?</AlertDialogTitle>
          <AlertDialogDescription>
            Se cierra la acción y se completa su vencimiento en el calendario. Describí la evidencia
            de regularización (queda en el historial).
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="evidencia-cierre">Evidencia de cierre</Label>
          <Textarea
            id="evidencia-cierre"
            rows={3}
            value={evidencia}
            onChange={(e) => setEvidencia(e.target.value)}
            maxLength={EVIDENCIA_MAX}
            placeholder="Ej: se reemplazaron los matafuegos vencidos; foto adjunta al legajo…"
            disabled={isPending}
            aria-invalid={evidencia.length > 0 && !evidenciaValid}
          />
          {evidencia.length > 0 && !evidenciaValid && (
            <p className="text-destructive text-xs">
              La evidencia debe tener entre {EVIDENCIA_MIN} y {EVIDENCIA_MAX} caracteres.
            </p>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleResolver();
            }}
            disabled={isPending || !evidenciaValid}
          >
            Marcar resuelta
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
