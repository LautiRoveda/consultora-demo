import { redirect } from 'next/navigation';

import { env } from '@/env';
import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';

import { BillingView } from './BillingView';
import { getActiveSubscription, getInvoicesForConsultora } from './queries';

/**
 * T-072 · Settings/Billing — vista del estado de suscripción + historial.
 *
 * Server component que orquesta:
 *   1. Lookup de la consultora actual + role (para gate UI owner/member).
 *   2. Última suscripción del tenant (puede ser null en trial sin acción aún).
 *   3. Página actual de facturas (server-side paginated, 10/page).
 *   4. Lectura de `?status=` post-redirect de Mercado Pago (back_url callback).
 *
 * La página es siempre accesible: T-073 maneja el trial gate enforcement.
 * Acá sólo mostramos estado.
 */

const INVOICES_PAGE_SIZE = 10;

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) redirect('/login?error=no_consultora');

  const pageNum = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const offset = (pageNum - 1) * INVOICES_PAGE_SIZE;

  // Pedimos `limit + 1` para detectar si hay página siguiente sin un count
  // extra (cheap heuristic). Si vienen más de INVOICES_PAGE_SIZE rows,
  // descartamos la última y marcamos `hasNext = true`.
  const [suscripcion, invoicesPlusOne] = await Promise.all([
    getActiveSubscription(supabase),
    getInvoicesForConsultora(supabase, { limit: INVOICES_PAGE_SIZE + 1, offset }),
  ]);

  const hasNext = invoicesPlusOne.length > INVOICES_PAGE_SIZE;
  const invoices = hasNext ? invoicesPlusOne.slice(0, INVOICES_PAGE_SIZE) : invoicesPlusOne;

  const statusParam =
    params.status === 'success' || params.status === 'pending' || params.status === 'failure'
      ? params.status
      : null;

  // ARS_PRICE_MONTHLY es server-only (env.ts importa server-only). Lo
  // pasamos como prop al view para evitar fugar el módulo env al bundle
  // cliente.
  const priceCentavos = Number(env.ARS_PRICE_MONTHLY);

  return (
    <BillingView
      role={consultora.role}
      trialHasta={consultora.trialHasta}
      suscripcion={suscripcion}
      invoices={invoices}
      priceCentavos={priceCentavos}
      page={pageNum}
      hasNext={hasNext}
      statusParam={statusParam}
    />
  );
}
