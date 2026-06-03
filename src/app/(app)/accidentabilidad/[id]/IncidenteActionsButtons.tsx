'use client';

import type { TipoIncidente } from '../schema';
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/ui/tooltip';

import { anularIncidenteAction, generarInvestigacionIaAction } from '../actions';

const MOTIVO_MIN = 5;
const MOTIVO_MAX = 2000;

type Props = {
  incidenteId: string;
  /** T-075: gating del botón IA — solo accidentes. */
  tipo: TipoIncidente;
  /** T-075: si ya hay informe vinculado, el botón muta a "Ver informe". */
  informeId: string | null;
  /** T-075: sin cliente no se puede generar (razón social/CUIT salen del cliente). */
  tieneCliente: boolean;
};

/**
 * T-063 · Acciones del detail view sobre el registro VIGENTE: Corregir (link a
 * `/corregir`) + Anular (AlertDialog con `motivo`).
 *
 * T-075 · En accidentes suma "Generar investigación IA" (crea el informe
 * accidente pre-poblado y cae al editor) — o "Ver informe" si ya está vinculado.
 * Sin cliente, el botón se deshabilita con tooltip (no se emite un informe legal
 * con la empresa en blanco).
 *
 * El `motivo` usa estado controlado (no RHF anidado) — más simple y evita
 * quirks de form-in-dialog con el focus-trap de Radix.
 */
export function IncidenteActionsButtons({ incidenteId, tipo, informeId, tieneCliente }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [motivo, setMotivo] = useState('');

  const motivoTrim = motivo.trim();
  const motivoValid = motivoTrim.length >= MOTIVO_MIN && motivoTrim.length <= MOTIVO_MAX;

  function handleGenerarIa() {
    startTransition(async () => {
      const result = await generarInvestigacionIaAction(incidenteId);

      if (result.ok) {
        router.push(result.redirectTo);
        return;
      }

      switch (result.code) {
        case 'ALREADY_LINKED':
          toast.info('Este incidente ya tiene un informe de investigación');
          router.push(result.redirectTo);
          return;
        case 'NO_CLIENTE':
          toast.error('Falta el cliente', { description: result.message });
          return;
        case 'NOT_VIGENTE':
        case 'NOT_ACCIDENTE':
        case 'NOT_FOUND':
          toast.error('No se puede generar', { description: result.message });
          router.refresh();
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
        default:
          toast.error('Error inesperado', { description: result.message });
      }
    });
  }

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
    <div className="flex shrink-0 flex-wrap gap-2">
      {tipo === 'accidente' &&
        (informeId ? (
          <Button asChild>
            <Link href={`/informes/${informeId}`}>Ver informe</Link>
          </Button>
        ) : tieneCliente ? (
          <Button type="button" onClick={handleGenerarIa} disabled={isPending}>
            Generar investigación IA
          </Button>
        ) : (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button type="button" disabled>
                    Generar investigación IA
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Asociá un cliente al incidente para generar la investigación
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ))}
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
