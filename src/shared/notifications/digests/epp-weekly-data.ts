import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * T-109 · Capa de datos del digest semanal EPP. Corre con SERVICE ROLE (cron),
 * que BYPASSA RLS. Por eso cada query que trae datos de UNA consultora filtra
 * `.eq('consultora_id', ...)` EXPLICITO — sin la red de seguridad de RLS, un
 * filtro faltante seria un leak cross-tenant.
 */

type DbClient = SupabaseClient<Database>;

export type EppWeeklyResumen = {
  entregas7d: number;
  vencimientos7d: { empleado: string; item: string; fechaIso: string }[];
};

export type ConsultoraConActividad = { id: string; name: string };

/**
 * Barrido GLOBAL (intencional, sin filtro por tenant): consultoras con al menos
 * una entrega firmada en [desdeIso, nowIso] O una planificacion activa que vence
 * en [nowIso, hastaIso]. Cada fila trae su propio consultora_id; agrupamos por
 * el en un Set, sin mezclar atribuciones. El filtro por tenant lo hace
 * `armarResumenEpp` (abajo), no este barrido.
 */
export async function resolverConsultorasConActividad(
  admin: DbClient,
  desdeIso: string,
  nowIso: string,
  hastaIso: string,
): Promise<ConsultoraConActividad[]> {
  const [entRes, planRes] = await Promise.all([
    admin
      .from('epp_entregas')
      .select('consultora_id')
      .gte('firmado_at', desdeIso)
      .lte('firmado_at', nowIso),
    admin
      .from('epp_planificaciones')
      .select('consultora_id')
      .eq('estado', 'activa')
      .gte('fecha_proxima_entrega', nowIso)
      .lte('fecha_proxima_entrega', hastaIso),
  ]);

  const ids = new Set<string>();
  for (const r of entRes.data ?? []) ids.add(r.consultora_id);
  for (const r of planRes.data ?? []) ids.add(r.consultora_id);
  if (ids.size === 0) return [];

  const { data } = await admin
    .from('consultoras')
    .select('id, name')
    .in('id', [...ids]);
  return data ?? [];
}

/**
 * Resumen EPP de UNA consultora. Filtro `.eq('consultora_id', consultoraId)`
 * explicito en cada query (defensa cross-tenant bajo service role).
 */
export async function armarResumenEpp(
  admin: DbClient,
  consultoraId: string,
  desdeIso: string,
  nowIso: string,
  hastaIso: string,
): Promise<EppWeeklyResumen> {
  const { count } = await admin
    .from('epp_entregas')
    .select('id', { count: 'exact', head: true })
    .eq('consultora_id', consultoraId)
    .gte('firmado_at', desdeIso)
    .lte('firmado_at', nowIso);

  const { data: planiRaw } = await admin
    .from('epp_planificaciones')
    .select(
      'fecha_proxima_entrega, ' +
        'empleado:empleados!inner(nombre, apellido), ' +
        'item:epp_items!inner(nombre)',
    )
    .eq('consultora_id', consultoraId)
    .eq('estado', 'activa')
    .gte('fecha_proxima_entrega', nowIso)
    .lte('fecha_proxima_entrega', hastaIso)
    .order('fecha_proxima_entrega', { ascending: true });

  const vencimientos7d = (planiRaw ?? []).map((row) => {
    const r = row as unknown as {
      fecha_proxima_entrega: string;
      empleado: { nombre: string; apellido: string } | null;
      item: { nombre: string } | null;
    };
    return {
      empleado: r.empleado ? `${r.empleado.apellido}, ${r.empleado.nombre}` : '—',
      item: r.item?.nombre ?? '—',
      fechaIso: r.fecha_proxima_entrega,
    };
  });

  return { entregas7d: count ?? 0, vencimientos7d };
}

/**
 * Predicado "vale la pena mandar" (ajuste T-109): NO mandar email vacio. Solo
 * si hay >=1 entrega firmada en 7d O >=1 vencimiento en los proximos 7d.
 */
export function resumenEsAccionable(resumen: EppWeeklyResumen): boolean {
  return resumen.entregas7d > 0 || resumen.vencimientos7d.length > 0;
}
