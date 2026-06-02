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
import { Label } from '@/shared/ui/label';
import { Textarea } from '@/shared/ui/textarea';

import { anularIncidenteAction } from '../actions';

const MOTIVO_MIN = 5;
const MOTIVO_MAX = 2000;

/**
 * T-063 · Acciones del detail view sobre el registro VIGENTE: Corregir (link a
 * `/corregir`) + Anular (AlertDialog con `motivo`). Sin botón "Generar
 * investigación IA" — el link `informe_id` se difiere a un ticket dedicado.
 *
 * El `motivo` usa estado controlado (no RHF anidado) — más simple y evita
 * quirks de form-in-dialog con el focus-trap de Radix.
 */
export function IncidenteActionsButtons({ incidenteId }: { incidenteId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [motivo, setMotivo] = useState('');

  const motivoTrim = motivo.trim();
  const motivoValid = motivoTrim.length >= MOTIVO_MIN && motivoTrim.length <= MOTIVO_MAX;

  function handleAnular() {
    if (!motivoValid) return;
    startTransition(async () => {
      const result = await anularIncidenteAction({ id: incidenteId, motivo: motivoTrim });

      if (result.ok) {
        toast.success('Incidente anulado');
        setDialogOpen(false);
        router.refresh();
        return;
      }

      switch (result.code) {
        case 'ALREADY_CORRECTED':
          toast.info('Ese incidente ya fue corregido o anulado');
          setDialogOpen(false);
          router.refresh();
          return;
        case 'NOT_FOUND':
          toast.error('Incidente no encontrado');
          router.push('/accidentabilidad');
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
        <Link href={`/accidentabilidad/${incidenteId}/corregir`}>Corregir</Link>
      </Button>
      <AlertDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setMotivo('');
        }}
      >
        <AlertDialogTrigger asChild>
          <Button variant="outline" disabled={isPending}>
            Anular
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Anular este incidente?</AlertDialogTitle>
            <AlertDialogDescription>
              La anulación es definitiva y queda registrada en el libro. Indicá el motivo (se guarda
              en el historial).
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
              placeholder="Ej: cargado por error, duplicado de otro registro…"
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
              Anular incidente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
