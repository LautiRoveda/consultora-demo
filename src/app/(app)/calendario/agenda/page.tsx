import { redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';

import {
  getCalendarEventsForConsultora,
  getEventsBeyondDays,
  getOverdueEvents,
  getUpcomingEvents,
} from '../queries';
import { parseUrlState } from '../url-state';
import { AgendaView } from './AgendaView';

/**
 * T-030 · Vista agenda lista del modulo Calendario.
 *
 * Server Component: parsea searchParams (URL state shareable), valida session
 * + consultora, fetchea eventos segun el modo (buckets vs flat).
 *
 * Modo dual derivado del filtro `status` (decision 12 del plan):
 *  - status incluye `pending` (default) → ejecuta 3 queries en paralelo
 *    (upcoming + overdue + beyond) → AgendaView las bucketiza client-side.
 *    Filtro `tipo` se aplica en memoria (las queries especializadas no aceptan
 *    tipo[]; volumen chico, costo despreciable).
 *  - status NO incluye `pending` → 1 query plana
 *    (getCalendarEventsForConsultora) ordenada por fecha ASC, reverse en
 *    memoria para devolver DESC (historial reverso).
 */
export default async function CalendarioAgendaPage({
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
  if (!user) redirect('/login?next=/calendario/agenda');

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) redirect('/dashboard?error=no_consultora');

  const includesPending = urlState.status.includes('pending');

  if (includesPending) {
    const [upcoming, overdue, beyond] = await Promise.all([
      getUpcomingEvents(supabase, 30),
      getOverdueEvents(supabase),
      getEventsBeyondDays(supabase, 30),
    ]);

    const allPending = [...overdue, ...upcoming, ...beyond];
    const filtered =
      urlState.tipo.length > 0
        ? allPending.filter((e) => (urlState.tipo as readonly string[]).includes(e.tipo))
        : allPending;

    return (
      <AgendaView
        initialEvents={filtered}
        initialFilters={{ tipo: urlState.tipo, status: urlState.status }}
        initialEventOpen={urlState.event}
        currentUserId={user.id}
        currentUserRole={consultora.role}
        mode="buckets"
      />
    );
  }

  // Modo flat: status excluye pending (solo completed/cancelled o ambos).
  const eventsAsc = await getCalendarEventsForConsultora(supabase, {
    status: urlState.status,
    tipo: urlState.tipo.length > 0 ? urlState.tipo : undefined,
    limit: 200,
  });
  // DESC en memoria — historial reverso, mas recientes arriba.
  const events = [...eventsAsc].reverse();

  return (
    <AgendaView
      initialEvents={events}
      initialFilters={{ tipo: urlState.tipo, status: urlState.status }}
      initialEventOpen={urlState.event}
      currentUserId={user.id}
      currentUserRole={consultora.role}
      mode="flat"
    />
  );
}
