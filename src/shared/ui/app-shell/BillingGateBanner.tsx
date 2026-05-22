import type { BillingStatus } from '@/shared/billing/access';
import Link from 'next/link';

import { getGateMessage } from '@/shared/billing/messages';

/**
 * T-073 · Banner sticky persistente al tope del AppShell cuando el trial gate
 * está activo. NO dismissable — el user no puede ocultarlo sin suscribirse o
 * setear `BILLING_GATE_DISABLED=true` (sólo dev).
 *
 * Server component: el `billingStatus` se calcula en `(app)/layout.tsx` y se
 * pasa como prop. Cuando `ok=true`, este componente render-eás null (no
 * agrega DOM).
 */
export function BillingGateBanner({ billingStatus }: { billingStatus: BillingStatus }) {
  if (billingStatus.ok) return null;

  return (
    <div
      role="alert"
      className="bg-destructive text-destructive-foreground sticky top-0 z-40 px-4 py-2 text-sm shadow-sm"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <p className="font-medium">{getGateMessage(billingStatus.reason)}</p>
        <Link
          href="/settings/billing"
          className="font-semibold whitespace-nowrap underline underline-offset-2 hover:no-underline"
        >
          Suscribirme →
        </Link>
      </div>
    </div>
  );
}
