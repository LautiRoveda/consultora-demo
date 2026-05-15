import { redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';

import { CalendarView } from './CalendarView';
import { getCalendarEventsForConsultora } from './queries';
import { monthBoundsIso, parseUrlState } from './url-state';

/**
 * T-029 · Vista mensual del calendario de vencimientos.
 *
 * Server Component: parsea searchParams (URL state shareable), valida session
 * + consultora, lista eventos del mes visible filtrados, delega al client
 * `CalendarView` que orquesta interactividad (filtros, drawer, navegacion).
 *
 * Cap `limit: 500`: cubre PYMEs grandes (10 clientes x 2 vencimientos/mes
 * promedio = 20). Plan supera el cap → vista del mes va a perder eventos —
 * paginacion mensual queda como follow-up post-MVP.
 */
export default async function CalendarioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const urlState = parseUrlState(sp);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/calendario');

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) redirect('/dashboard?error=no_consultora');

  const [fechaFrom, fechaTo] = monthBoundsIso(urlState.year, urlState.month);
  const events = await getCalendarEventsForConsultora(supabase, {
    status: urlState.status,
    tipo: urlState.tipo.length > 0 ? urlState.tipo : undefined,
    fechaFrom,
    fechaTo,
    limit: 500,
  });

  return (
    <CalendarView
      initialEvents={events}
      initialMonth={{ year: urlState.year, month: urlState.month }}
      initialFilters={{ tipo: urlState.tipo, status: urlState.status }}
      initialEventOpen={urlState.event}
      currentUserId={user.id}
      currentUserRole={consultora.role}
    />
  );
}
