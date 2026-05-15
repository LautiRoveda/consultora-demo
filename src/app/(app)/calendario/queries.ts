import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CalendarEventStatus, CalendarEventTipo } from './defaults';

/**
 * T-028 · Queries de lectura del modulo Calendario.
 *
 * Todas reciben el client authed como primer arg → RLS automaticamente filtra
 * por consultora del JWT. NO escribir queries que tomen `consultora_id` como
 * parametro: la fuente de verdad es el claim, no el caller.
 */

export type CalendarEventRow = Database['public']['Tables']['calendar_events']['Row'];
export type CalendarEventReminderRow =
  Database['public']['Tables']['calendar_event_reminders']['Row'];

export type GetEventsOptions = {
  status?: ReadonlyArray<CalendarEventStatus>;
  tipo?: ReadonlyArray<CalendarEventTipo>;
  /** YYYY-MM-DD inclusive. */
  fechaFrom?: string;
  /** YYYY-MM-DD inclusive. */
  fechaTo?: string;
  limit?: number;
  offset?: number;
};

/**
 * Lista paginada de eventos de la consultora del user logueado, con filtros
 * opcionales. ORDER BY fecha_vencimiento ASC + tie-break por id.
 */
export async function getCalendarEventsForConsultora(
  supabase: SupabaseClient<Database>,
  options: GetEventsOptions = {},
): Promise<CalendarEventRow[]> {
  let query = supabase
    .from('calendar_events')
    .select('*')
    .order('fecha_vencimiento', { ascending: true })
    .order('id', { ascending: true });

  if (options.status && options.status.length > 0) {
    query = query.in('status', [...options.status]);
  }
  if (options.tipo && options.tipo.length > 0) {
    query = query.in('tipo', [...options.tipo]);
  }
  if (options.fechaFrom) {
    query = query.gte('fecha_vencimiento', options.fechaFrom);
  }
  if (options.fechaTo) {
    query = query.lte('fecha_vencimiento', options.fechaTo);
  }

  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;
  query = query.range(offset, offset + limit - 1);

  const { data } = await query;
  return data ?? [];
}

/**
 * Devuelve el evento + sus reminders. 2 queries en lugar de embedded join para
 * que el shape sea predecible y typed sin gymnastics.
 *
 * Cross-tenant: RLS filtra el SELECT del evento → null. Si el evento existe en
 * otra consultora, el caller recibe `null` igual que si no existiera.
 */
export async function getCalendarEventById(
  supabase: SupabaseClient<Database>,
  eventId: string,
): Promise<{ event: CalendarEventRow; reminders: CalendarEventReminderRow[] } | null> {
  const { data: event } = await supabase
    .from('calendar_events')
    .select('*')
    .eq('id', eventId)
    .maybeSingle();
  if (!event) return null;

  const { data: reminders } = await supabase
    .from('calendar_event_reminders')
    .select('*')
    .eq('event_id', eventId)
    .order('offset_days', { ascending: false });

  return { event, reminders: reminders ?? [] };
}

/**
 * Eventos pendientes con vencimiento en los proximos N dias (default 30).
 * Usado por el panel "proximos vencimientos" del dashboard (T-030).
 *
 * Rango: [today, today + daysAhead] inclusive (formato YYYY-MM-DD; comparacion
 * lexicografica equivale a comparacion temporal).
 */
export async function getUpcomingEvents(
  supabase: SupabaseClient<Database>,
  daysAhead = 30,
): Promise<CalendarEventRow[]> {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  const horizon = new Date(today.getTime());
  horizon.setUTCDate(horizon.getUTCDate() + daysAhead);
  const horizonIso = horizon.toISOString().slice(0, 10);

  const { data } = await supabase
    .from('calendar_events')
    .select('*')
    .eq('status', 'pending')
    .gte('fecha_vencimiento', todayIso)
    .lte('fecha_vencimiento', horizonIso)
    .order('fecha_vencimiento', { ascending: true });
  return data ?? [];
}

/**
 * Eventos pendientes ya vencidos (fecha < today). Usado por el banner "vencidos"
 * del dashboard.
 */
export async function getOverdueEvents(
  supabase: SupabaseClient<Database>,
): Promise<CalendarEventRow[]> {
  const todayIso = new Date().toISOString().slice(0, 10);

  const { data } = await supabase
    .from('calendar_events')
    .select('*')
    .eq('status', 'pending')
    .lt('fecha_vencimiento', todayIso)
    .order('fecha_vencimiento', { ascending: true });
  return data ?? [];
}

/**
 * Eventos vinculados a un informe. Usado por T-036 modal post-firma para
 * detectar si el informe ya tiene un vencimiento auto-creado y evitar
 * duplicados.
 */
export async function getEventsByInformeId(
  supabase: SupabaseClient<Database>,
  informeId: string,
): Promise<CalendarEventRow[]> {
  const { data } = await supabase
    .from('calendar_events')
    .select('*')
    .eq('informe_id', informeId)
    .order('fecha_vencimiento', { ascending: true });
  return data ?? [];
}
