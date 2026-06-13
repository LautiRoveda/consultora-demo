'use client';

import { CheckCircle2 } from 'lucide-react';
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

import { presentarRarAction } from '../actions';

interface Props {
  clienteId: string;
  periodo: number;
  /** Trabajadores con CUIL/fecha de ingreso faltante (warning no bloqueante). */
  faltanDatosCount: number;
  /** El cliente no tiene ART registrada (warning no bloqueante). */
  clienteSinArt: boolean;
}

/**
 * T-146 · "Marcar como presentado" — registra la presentación del RAR del período
 * actual. Muestra los warnings (datos faltantes + ART) ANTES de confirmar; el
 * matriculado decide presentar igual (la presentación es un registro legal).
 */
export function MarcarPresentadoButton({
  clienteId,
  periodo,
  faltanDatosCount,
  clienteSinArt,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const tieneWarnings = faltanDatosCount > 0 || clienteSinArt;

  function handleConfirm() {
    setOpen(false);
    startTransition(async () => {
      const result = await presentarRarAction({ cliente_id: clienteId, periodo });

      if (result.ok) {
        if (result.warnings.length > 0) {
          toast.success('Presentación registrada', {
            description: result.warnings.join(' '),
          });
        } else {
          toast.success('Presentación registrada');
        }
        router.refresh();
        return;
      }

      switch (result.code) {
        case 'DUPLICATE':
          toast.info('Ya estaba presentado', { description: result.message });
          router.refresh();
          return;
        case 'UNAUTHENTICATED':
          toast.error('Sesión vencida', { description: result.message });
          router.push('/login');
          return;
        case 'BILLING_GATED':
          toast.error('Suscripción requerida', { description: result.message });
          return;
        case 'CLIENTE_NOT_FOUND':
          toast.error('Cliente no disponible', { description: result.message });
          return;
        default:
          toast.error('No se pudo registrar la presentación', { description: result.message });
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !isPending && setOpen(next)}>
      <AlertDialogTrigger asChild>
        <Button size="sm" disabled={isPending}>
          <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
          Marcar como presentado
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Registrar la presentación del RAR {periodo}?</AlertDialogTitle>
          <AlertDialogDescription>
            Se registra la presentación (con una foto de la nómina actual) y se agenda el próximo
            vencimiento anual con recordatorios. El registro es inmutable.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {tieneWarnings && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">Antes de presentar, revisá:</p>
            <ul className="mt-1 list-inside list-disc">
              {faltanDatosCount > 0 && (
                <li>
                  {faltanDatosCount} trabajador{faltanDatosCount === 1 ? '' : 'es'} con datos
                  incompletos (CUIL o fecha de ingreso).
                </li>
              )}
              {clienteSinArt && <li>El cliente no tiene ART registrada.</li>}
            </ul>
            <p className="mt-1 text-amber-800">
              Podés presentar igual: el matriculado decide. Quedará registrado tal como está hoy.
            </p>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={isPending}>
            Confirmar presentación
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
