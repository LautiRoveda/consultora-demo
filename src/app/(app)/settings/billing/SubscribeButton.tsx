'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/shared/ui/button';

import { createSubscriptionAction } from './actions';

/**
 * T-072 · Botón que dispara `createSubscriptionAction` + redirect a MP.
 *
 * Owner-only en server (la action gatekeepea); el padre ya esconde el botón
 * para members, pero la action lo refuerza por defense-in-depth.
 *
 * Flow happy: action ok → toast info → `location.href = initPoint` (NO
 * `router.push`, init_point es una URL externa de mercadopago.com.ar).
 */
export function SubscribeButton({ label = 'Suscribirme' }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick(): void {
    startTransition(async () => {
      const result = await createSubscriptionAction();
      if (result.ok) {
        toast.info('Te redirigimos a Mercado Pago...');
        // Hard navigation: init_point apunta a www.mercadopago.com.ar/preapproval.
        window.location.href = result.initPoint;
        return;
      }
      switch (result.code) {
        case 'DUPLICATE_SUBSCRIPTION':
          toast.warning('Suscripción ya existente', { description: result.message });
          router.refresh();
          return;
        case 'FORBIDDEN_NOT_OWNER':
          toast.error('Sin permiso', { description: result.message });
          return;
        case 'UNAUTHENTICATED':
          toast.error('Sesión vencida', { description: result.message });
          router.push('/login');
          return;
        case 'NO_EMAIL':
        case 'NO_CONSULTORA':
        case 'MP_API_ERROR':
        case 'INTERNAL_ERROR':
          toast.error('No pudimos suscribirte', { description: result.message });
          return;
      }
    });
  }

  return (
    <Button type="button" onClick={onClick} disabled={pending} data-testid="subscribe-button">
      {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {label}
    </Button>
  );
}
