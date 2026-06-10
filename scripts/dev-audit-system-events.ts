/**
 * T-133 · Auditoría READ-ONLY de eventos system-generated creados a mano.
 *
 * Antes del hardening M-1 un usuario autenticado podía crear eventos
 * epp_entrega / accion_correctiva por el form manual. Este script dimensiona
 * esas filas pre-fix en la DB apuntada por el env: un evento system legítimo
 * está referenciado por su origen de dominio
 * (epp_planificaciones.calendar_event_id / acciones_correctivas.calendar_event_id);
 * los no referenciados son manuales/sospechosos. También cuenta los que tienen
 * recurrence_months no-null (riesgo auto-recurrencia: el clon authenticated
 * choca la policy nueva y se loguea auto_recurrence_failed).
 *
 * SOLO SELECT — no muta nada. NO corre en CI. Lo ejecuta el owner contra prod
 * tras su OK (resultado al PR; remediación = ticket aparte):
 *   pnpm tsx --env-file=.env.local scripts/dev-audit-system-events.ts
 * Service-role desde env — jamás hardcodear credenciales.
 *
 * Output sin PII: counts + sample de ids/consultora_id (los títulos de eventos
 * EPP contienen nombres de empleados → NO se imprimen).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';

type EventRow = { id: string; consultora_id: string; recurrence_months: number | null };

const PAGE = 1000;

async function fetchAllEvents(c: SupabaseClient, tipo: string): Promise<EventRow[]> {
  const rows: EventRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await c
      .from('calendar_events')
      .select('id, consultora_id, recurrence_months')
      .eq('tipo', tipo)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`calendar_events(${tipo}): ${error.message}`);
    rows.push(...((data ?? []) as EventRow[]));
    if (!data || data.length < PAGE) return rows;
  }
}

async function fetchAllRefs(c: SupabaseClient, table: string): Promise<Set<string>> {
  const refs = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await c
      .from(table)
      .select('calendar_event_id')
      .not('calendar_event_id', 'is', null)
      .order('calendar_event_id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    for (const r of (data ?? []) as Array<{ calendar_event_id: string }>) {
      refs.add(r.calendar_event_id);
    }
    if (!data || data.length < PAGE) return refs;
  }
}

function report(label: string, events: EventRow[], refs: Set<string>): EventRow[] {
  const orphans = events.filter((e) => !refs.has(e.id));
  console.log(
    `\n[${label}] total: ${events.length} · referenciados: ${events.length - orphans.length} · SIN origen (manuales/sospechosos): ${orphans.length}`,
  );
  for (const o of orphans.slice(0, 10)) {
    console.log(
      `  - event ${o.id} · consultora ${o.consultora_id} · recurrence_months=${o.recurrence_months}`,
    );
  }
  if (orphans.length > 10) console.log(`  … y ${orphans.length - 10} más`);
  return orphans;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el env.');
    process.exit(1);
  }
  const c = createClient(url, key, { auth: { persistSession: false } });

  const eppEvents = await fetchAllEvents(c, 'epp_entrega');
  const planifRefs = await fetchAllRefs(c, 'epp_planificaciones');
  const eppOrphans = report('epp_entrega', eppEvents, planifRefs);

  const accEvents = await fetchAllEvents(c, 'accion_correctiva');
  const capaRefs = await fetchAllRefs(c, 'acciones_correctivas');
  const accOrphans = report('accion_correctiva', accEvents, capaRefs);

  const conRecurrencia = [...eppEvents, ...accEvents].filter((e) => e.recurrence_months !== null);
  console.log(
    `\n[recurrencia] filas system con recurrence_months NO-null: ${conRecurrencia.length}`,
  );
  for (const r of conRecurrencia.slice(0, 10)) {
    console.log(
      `  - event ${r.id} · consultora ${r.consultora_id} · recurrence_months=${r.recurrence_months}`,
    );
  }

  console.log(
    `\nResumen: ${eppOrphans.length + accOrphans.length} eventos system sin origen, ` +
      `${conRecurrencia.length} con recurrencia. Remediación (si aplica) = ticket aparte con OK del owner.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
