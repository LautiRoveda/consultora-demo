import 'server-only';

import type { Database, Json } from '@/shared/supabase/types';
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

/**
 * T-030 · Eventos pendientes con fecha_vencimiento > today + daysFrom. Usado
 * por el bucket "Mas adelante" de la vista agenda (`/calendario/agenda`).
 *
 * Default 30 dias matchea el horizonte de `getUpcomingEvents`: las dos queries
 * juntas (+ overdue) cubren la totalidad del universo pending sin solape.
 *
 * Limit configurable (default 200) para evitar saturar el bucket "Mas
 * adelante" de una consultora con muchos vencimientos a largo plazo. Cuando
 * llegue a doler, follow-up con virtual scrolling o "Ver mas".
 */
export async function getEventsBeyondDays(
  supabase: SupabaseClient<Database>,
  daysFrom = 30,
  limit = 200,
): Promise<CalendarEventRow[]> {
  const today = new Date();
  const horizon = new Date(today.getTime());
  horizon.setUTCDate(horizon.getUTCDate() + daysFrom);
  const horizonIso = horizon.toISOString().slice(0, 10);

  const { data } = await supabase
    .from('calendar_events')
    .select('*')
    .eq('status', 'pending')
    .gt('fecha_vencimiento', horizonIso)
    .order('fecha_vencimiento', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit);
  return data ?? [];
}

/**
 * T-105 · Context enrichment para eventos `tipo='epp_entrega'`.
 *
 * Resuelve los UUIDs de `metadata` ({ empleado_id, epp_item_id, epp_entrega_id })
 * a sus rows de display para que `EventViewPanel` muestre links navegables.
 *
 * Campos `null` = degraded (RLS cross-tenant reject, archived, hard-delete).
 * La UI renderiza `<eliminado>` en cada slot null sin romper la card.
 */
export type EppEventContext = {
  empleado: { id: string; nombre: string; apellido: string } | null;
  item: { id: string; nombre: string } | null;
  entrega: { id: string; fecha_entrega: string } | null;
};

type EppEventMetadataShape = {
  empleado_id: string;
  epp_item_id: string;
  epp_entrega_id: string;
};

function extractEppMetadata(m: Json | null): EppEventMetadataShape | null {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const obj = m as Record<string, unknown>;
  const empleado_id = obj.empleado_id;
  const epp_item_id = obj.epp_item_id;
  const epp_entrega_id = obj.epp_entrega_id;
  if (
    typeof empleado_id !== 'string' ||
    typeof epp_item_id !== 'string' ||
    typeof epp_entrega_id !== 'string'
  ) {
    return null;
  }
  return { empleado_id, epp_item_id, epp_entrega_id };
}

/**
 * Batch-fetch del context EPP para un frame de eventos (todos los eventos
 * visibles en /calendario o /calendario/agenda). 3 queries `.in(...)`
 * paralelas + dedup de UUIDs → costo constante sin importar cuántos eventos
 * EPP entren en el frame.
 *
 * RLS: usa el `supabase` authed que recibe → cross-tenant filtra
 * automáticamente. NO `createServiceRoleClient()` (lesson T-050/T-053).
 *
 * Empleado e item se filtran por `is('archived_at', null)`: rows archived
 * caen en degraded. `epp_entregas` no tiene `archived_at` (inmutable post-firma
 * Res 299/11), por eso no se filtra.
 */
export async function getEppContextForEvents(
  supabase: SupabaseClient<Database>,
  events: ReadonlyArray<CalendarEventRow>,
): Promise<Record<string, EppEventContext>> {
  const parsed: Array<{ eventId: string; meta: EppEventMetadataShape }> = [];
  for (const e of events) {
    if (e.tipo !== 'epp_entrega') continue;
    const meta = extractEppMetadata(e.metadata);
    if (!meta) continue;
    parsed.push({ eventId: e.id, meta });
  }
  if (parsed.length === 0) return {};

  const empleadoIds = [...new Set(parsed.map((p) => p.meta.empleado_id))];
  const itemIds = [...new Set(parsed.map((p) => p.meta.epp_item_id))];
  const entregaIds = [...new Set(parsed.map((p) => p.meta.epp_entrega_id))];

  const [empleadosRes, itemsRes, entregasRes] = await Promise.all([
    supabase
      .from('empleados')
      .select('id, nombre, apellido')
      .in('id', empleadoIds)
      .is('archived_at', null),
    supabase.from('epp_items').select('id, nombre').in('id', itemIds).is('archived_at', null),
    supabase.from('epp_entregas').select('id, fecha_entrega').in('id', entregaIds),
  ]);

  const empleadoMap = new Map<string, { id: string; nombre: string; apellido: string }>();
  for (const row of empleadosRes.data ?? []) {
    empleadoMap.set(row.id, { id: row.id, nombre: row.nombre, apellido: row.apellido });
  }
  const itemMap = new Map<string, { id: string; nombre: string }>();
  for (const row of itemsRes.data ?? []) {
    itemMap.set(row.id, { id: row.id, nombre: row.nombre });
  }
  const entregaMap = new Map<string, { id: string; fecha_entrega: string }>();
  for (const row of entregasRes.data ?? []) {
    entregaMap.set(row.id, { id: row.id, fecha_entrega: row.fecha_entrega });
  }

  const out: Record<string, EppEventContext> = {};
  for (const { eventId, meta } of parsed) {
    out[eventId] = {
      empleado: empleadoMap.get(meta.empleado_id) ?? null,
      item: itemMap.get(meta.epp_item_id) ?? null,
      entrega: entregaMap.get(meta.epp_entrega_id) ?? null,
    };
  }
  return out;
}
