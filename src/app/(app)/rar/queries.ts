import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export type AgenteRow = Database['public']['Tables']['rar_agentes']['Row'];
export type AgenteTipo = Database['public']['Enums']['agente_riesgo_tipo'];

export type AgenteAsignado = {
  agente_id: string;
  asignado_at: string;
  codigo: string;
  nombre: string;
  agente_tipo: AgenteTipo;
  cas: string | null;
  enfermedad_asociada: string | null;
  archived_at: string | null;
};

export type AgenteDisponible = {
  id: string;
  codigo: string;
  nombre: string;
  agente_tipo: AgenteTipo;
};

export type PuestoOption = {
  id: string;
  nombre: string;
};

type ListOptions = {
  includeArchived?: boolean;
};

const MAX_ASIGNADOS = 200;

/**
 * Lista el catálogo de agentes de riesgo del tenant. Por defecto solo activos;
 * `includeArchived` los incluye (para la gestión del catálogo).
 */
export async function listAgentesByConsultora(
  supabase: SupabaseClient<Database>,
  options: ListOptions = {},
): Promise<AgenteRow[]> {
  let query = supabase
    .from('rar_agentes')
    .select('*')
    .order('agente_tipo', { ascending: true })
    .order('nombre', { ascending: true })
    .order('id', { ascending: true });

  if (!options.includeArchived) {
    query = query.is('archived_at', null);
  }

  const { data } = await query;
  return data ?? [];
}

/**
 * Agentes de riesgo asignados a un puesto (exposición). Embed to-one
 * `rar_agentes!inner` sobre la junction `puesto_agentes` — hay exactamente una
 * relación FK entre ambas tablas (la FK compuesta Ring A), así que el hint por
 * nombre de tabla resuelve sin ambigüedad.
 */
export async function listAgentesDePuesto(
  supabase: SupabaseClient<Database>,
  puestoId: string,
): Promise<AgenteAsignado[]> {
  const { data } = await supabase
    .from('puesto_agentes')
    .select(
      'agente_id, asignado_at, rar_agentes!inner(codigo, nombre, agente_tipo, cas, enfermedad_asociada, archived_at)',
    )
    .eq('puesto_id', puestoId)
    .order('asignado_at', { ascending: false })
    .limit(MAX_ASIGNADOS);

  if (!data) return [];

  return data.map((row) => ({
    agente_id: row.agente_id,
    asignado_at: row.asignado_at,
    codigo: row.rar_agentes.codigo,
    nombre: row.rar_agentes.nombre,
    agente_tipo: row.rar_agentes.agente_tipo,
    cas: row.rar_agentes.cas,
    enfermedad_asociada: row.rar_agentes.enfermedad_asociada,
    archived_at: row.rar_agentes.archived_at,
  }));
}

/**
 * Agentes activos del catálogo del tenant que aún NO están asignados al puesto.
 * 2 queries + diff in-JS (catálogo típico < 30 agentes — más simple que un NOT
 * IN anidado, costo despreciable). Molde `listPuestosDisponiblesParaAsignar`.
 */
export async function listAgentesDisponiblesParaPuesto(
  supabase: SupabaseClient<Database>,
  puestoId: string,
  consultoraId: string,
): Promise<AgenteDisponible[]> {
  const [catalogoRes, asignadosRes] = await Promise.all([
    supabase
      .from('rar_agentes')
      .select('id, codigo, nombre, agente_tipo')
      .eq('consultora_id', consultoraId)
      .is('archived_at', null)
      .order('agente_tipo', { ascending: true })
      .order('nombre', { ascending: true }),
    supabase.from('puesto_agentes').select('agente_id').eq('puesto_id', puestoId),
  ]);

  const catalogo = catalogoRes.data ?? [];
  const asignados = new Set((asignadosRes.data ?? []).map((r) => r.agente_id));

  return catalogo
    .filter((a) => !asignados.has(a.id))
    .map((a) => ({ id: a.id, codigo: a.codigo, nombre: a.nombre, agente_tipo: a.agente_tipo }));
}

/**
 * Puestos activos del catálogo del tenant — para el selector de la vista de
 * exposición (rar/exposicion).
 */
export async function listPuestosActivos(
  supabase: SupabaseClient<Database>,
  consultoraId: string,
): Promise<PuestoOption[]> {
  const { data } = await supabase
    .from('puestos')
    .select('id, nombre')
    .eq('consultora_id', consultoraId)
    .is('archived_at', null)
    .order('nombre', { ascending: true });

  return (data ?? []).map((p) => ({ id: p.id, nombre: p.nombre }));
}

export async function getAgenteById(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<AgenteRow | null> {
  const { data } = await supabase.from('rar_agentes').select('*').eq('id', id).maybeSingle();
  return data ?? null;
}
