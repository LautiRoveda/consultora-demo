import 'server-only';

import type { Database, Json } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

import { TIPO_ORDER } from './labels';

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
 * Agentes de riesgo asignados a un puesto EN un cliente/establecimiento
 * (exposición, T-145). Embed to-one `rar_agentes!inner` sobre la junction
 * `cliente_puesto_agentes` — hay exactamente una relación FK entre ambas tablas
 * (la FK compuesta Ring A del agente), así que el hint por nombre de tabla
 * resuelve sin ambigüedad.
 */
export async function listAgentesDeClientePuesto(
  supabase: SupabaseClient<Database>,
  clienteId: string,
  puestoId: string,
): Promise<AgenteAsignado[]> {
  const { data } = await supabase
    .from('cliente_puesto_agentes')
    .select(
      'agente_id, asignado_at, rar_agentes!inner(codigo, nombre, agente_tipo, cas, enfermedad_asociada, archived_at)',
    )
    .eq('cliente_id', clienteId)
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
 * Agentes activos del catálogo del tenant que aún NO están asignados al puesto
 * EN este cliente/establecimiento (T-145). 2 queries + diff in-JS (catálogo
 * típico < 30 agentes — más simple que un NOT IN anidado, costo despreciable).
 * Molde `listPuestosDisponiblesParaAsignar`.
 */
export async function listAgentesDisponiblesParaPuesto(
  supabase: SupabaseClient<Database>,
  clienteId: string,
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
    supabase
      .from('cliente_puesto_agentes')
      .select('agente_id')
      .eq('cliente_id', clienteId)
      .eq('puesto_id', puestoId),
  ]);

  const catalogo = catalogoRes.data ?? [];
  const asignados = new Set((asignadosRes.data ?? []).map((r) => r.agente_id));

  return catalogo
    .filter((a) => !asignados.has(a.id))
    .map((a) => ({ id: a.id, codigo: a.codigo, nombre: a.nombre, agente_tipo: a.agente_tipo }));
}

/**
 * T-145 · Puestos con ≥1 empleado activo en un cliente/establecimiento — para el
 * selector de la vista de exposición (rar/exposicion), tras elegir el cliente.
 * La exposición es por establecimiento: solo tiene sentido declarar agentes para
 * los puestos que efectivamente tienen dotación en ese cliente (los que aportan a
 * la NTE). 2 queries + dedup in-JS (molde pasos 1-2 de `listExpuestosByCliente`).
 */
export async function listPuestosDeCliente(
  supabase: SupabaseClient<Database>,
  clienteId: string,
): Promise<PuestoOption[]> {
  // 1. Empleados activos del cliente.
  const { data: empleadosRaw } = await supabase
    .from('empleados')
    .select('id')
    .eq('cliente_id', clienteId)
    .is('archived_at', null);

  const empleadoIds = (empleadosRaw ?? []).map((e) => e.id);
  if (empleadoIds.length === 0) return [];

  // 2. empleados_puestos → puestos vigentes (embed to-one !inner), distinct.
  const { data: epRaw } = await supabase
    .from('empleados_puestos')
    .select('puesto_id, puestos!inner(nombre, archived_at)')
    .in('empleado_id', empleadoIds);

  const porId = new Map<string, string>();
  for (const row of epRaw ?? []) {
    if (row.puestos.archived_at !== null) continue;
    porId.set(row.puesto_id, row.puestos.nombre);
  }

  return [...porId.entries()]
    .map(([id, nombre]) => ({ id, nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

export async function getAgenteById(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<AgenteRow | null> {
  const { data } = await supabase.from('rar_agentes').select('*').eq('id', id).maybeSingle();
  return data ?? null;
}

/** Presentación de RAR de un cliente/establecimiento para un período (año). */
export type RarPresentacionRef = {
  id: string;
  periodo: number;
  fecha_presentacion: string;
  fecha_vencimiento: string;
};

/**
 * T-146 · Busca la presentación del RAR de un cliente para un período (año). La
 * planilla la usa para mostrar "Presentado el … · vence el …" en vez del botón
 * "Marcar como presentado". RLS-aware (SELECT member); única por
 * (consultora, cliente, periodo).
 */
export async function getRarPresentacionForPeriodo(
  supabase: SupabaseClient<Database>,
  clienteId: string,
  periodo: number,
): Promise<RarPresentacionRef | null> {
  const { data } = await supabase
    .from('rar_presentaciones')
    .select('id, periodo, fecha_presentacion, fecha_vencimiento')
    .eq('cliente_id', clienteId)
    .eq('periodo', periodo)
    .maybeSingle();
  return data ?? null;
}

/**
 * T-147 · Historial de presentaciones del RAR de un cliente/establecimiento,
 * más reciente primero. Alimenta la sección "Presentaciones anteriores" de
 * `/rar/planilla` con un link de descarga histórica por fila. RLS-aware
 * (SELECT member).
 */
export async function listPresentacionesByCliente(
  supabase: SupabaseClient<Database>,
  clienteId: string,
): Promise<RarPresentacionRef[]> {
  const { data } = await supabase
    .from('rar_presentaciones')
    .select('id, periodo, fecha_presentacion, fecha_vencimiento')
    .eq('cliente_id', clienteId)
    .order('periodo', { ascending: false });
  return data ?? [];
}

/** Presentación completa con el snapshot legal congelado, para la descarga histórica. */
export type RarPresentacion = RarPresentacionRef & {
  consultora_id: string;
  cliente_id: string;
  snapshot: Json;
};

/**
 * T-147 · Trae una presentación del RAR por id, incluyendo `consultora_id`
 * (para la defensa cross-tenant del print page/route) y el `snapshot` jsonb
 * congelado al presentar. RLS-aware (SELECT member); el caller parsea el
 * snapshot defensivamente al shape de la planilla. Null si no existe / no es
 * del tenant.
 */
export async function getPresentacionById(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<RarPresentacion | null> {
  const { data } = await supabase
    .from('rar_presentaciones')
    .select(
      'id, consultora_id, cliente_id, periodo, fecha_presentacion, fecha_vencimiento, snapshot',
    )
    .eq('id', id)
    .maybeSingle();
  return data ?? null;
}

/** Referencia compacta a un agente de riesgo para la planilla RAR (NTE + DAR). */
export type RarAgenteRef = {
  agente_id: string;
  codigo: string;
  nombre: string;
  agente_tipo: AgenteTipo;
};

/** Trabajador expuesto: hereda la unión de agentes de sus puestos vigentes. */
export type RarExpuesto = {
  empleado_id: string;
  apellido: string;
  nombre: string;
  cuil: string | null;
  dni: string | null;
  fecha_ingreso: string | null;
  /** Nombres de los puestos activos del empleado. */
  puestos: string[];
  /** Unión dedup de agentes de todos sus puestos, ordenada por tipo/nombre. */
  agentes: RarAgenteRef[];
  /** `true` si falta CUIL o fecha de ingreso (warning no bloqueante, T-144 D3). */
  faltan_datos: boolean;
};

/** Nómina viva para la planilla RAR de un cliente/establecimiento. */
export type RarPlanillaNomina = {
  /** Solo empleados con ≥1 agente heredado (los "expuestos"). */
  expuestos: RarExpuesto[];
  /** Set distinct de agentes presentes en el establecimiento, para el DAR. */
  agentes: RarAgenteRef[];
};

/** Ordena agentes por tipo (físico→químico→bio→ergo) y luego por nombre. */
function sortAgentes(agentes: RarAgenteRef[]): RarAgenteRef[] {
  return agentes.sort((a, b) => {
    const ta = TIPO_ORDER.indexOf(a.agente_tipo);
    const tb = TIPO_ORDER.indexOf(b.agente_tipo);
    if (ta !== tb) return ta - tb;
    return a.nombre.localeCompare(b.nombre, 'es');
  });
}

/**
 * T-144 · Nómina de trabajadores expuestos de un cliente/establecimiento, para
 * la planilla RAR (NTE + DAR). Derivada de la herencia puesto→empleado de la
 * Fase 1: un empleado "expuesto" es el que tiene ≥1 puesto con ≥1 agente.
 *
 * Estrategia: queries mínimas + merge in-JS (molde `epp/padron/queries.ts` +
 * el embed `!inner` de `getEmpleadoPuestosLabel`). NO usamos el embed anidado de
 * 4 niveles (empleado→empleados_puestos→puesto_agentes→rar_agentes) — frágil; lo
 * resolvemos con tres selects de un solo nivel y `Map` en memoria. Hay una
 * dependencia real: `puesto_agentes` se filtra por los `puesto_id` que sólo se
 * conocen tras leer `empleados_puestos`.
 *
 * RLS-aware: el client de sesión + `cliente_id` acotan el tenant. Solo empleados
 * activos (`archived_at IS NULL`) y solo puestos vigentes. Datos faltantes (CUIL
 * / fecha de ingreso) NO excluyen al empleado: se marcan con `faltan_datos`.
 */
export async function listExpuestosByCliente(
  supabase: SupabaseClient<Database>,
  clienteId: string,
): Promise<RarPlanillaNomina> {
  // 1. Empleados activos del cliente (anchor).
  const { data: empleadosRaw } = await supabase
    .from('empleados')
    .select('id, nombre, apellido, cuil, dni, fecha_ingreso')
    .eq('cliente_id', clienteId)
    .is('archived_at', null)
    .order('apellido', { ascending: true })
    .order('nombre', { ascending: true });

  const empleados = empleadosRaw ?? [];
  if (empleados.length === 0) return { expuestos: [], agentes: [] };
  const empleadoIds = empleados.map((e) => e.id);

  // 2. empleados_puestos → puestos vigentes (embed to-one !inner).
  const { data: epRaw } = await supabase
    .from('empleados_puestos')
    .select('empleado_id, puesto_id, puestos!inner(nombre, archived_at)')
    .in('empleado_id', empleadoIds);

  const puestosByEmpleado = new Map<string, { puestoId: string; nombre: string }[]>();
  const puestoIds = new Set<string>();
  for (const row of epRaw ?? []) {
    if (row.puestos.archived_at !== null) continue;
    const list = puestosByEmpleado.get(row.empleado_id) ?? [];
    list.push({ puestoId: row.puesto_id, nombre: row.puestos.nombre });
    puestosByEmpleado.set(row.empleado_id, list);
    puestoIds.add(row.puesto_id);
  }

  // 3. cliente_puesto_agentes → rar_agentes (embed to-one !inner), acotado al
  //    cliente/establecimiento (T-145: la exposición ya está scopeada al cliente,
  //    más simple que filtrar por el set de puestos). Se mapea por puesto_id para
  //    el merge de la herencia.
  const agentesByPuesto = new Map<string, RarAgenteRef[]>();
  if (puestoIds.size > 0) {
    const { data: paRaw } = await supabase
      .from('cliente_puesto_agentes')
      .select('puesto_id, agente_id, rar_agentes!inner(codigo, nombre, agente_tipo)')
      .eq('cliente_id', clienteId);
    for (const row of paRaw ?? []) {
      const list = agentesByPuesto.get(row.puesto_id) ?? [];
      list.push({
        agente_id: row.agente_id,
        codigo: row.rar_agentes.codigo,
        nombre: row.rar_agentes.nombre,
        agente_tipo: row.rar_agentes.agente_tipo,
      });
      agentesByPuesto.set(row.puesto_id, list);
    }
  }

  // 4. Merge: por empleado, unir (dedup por agente_id) los agentes de sus
  //    puestos. Expuesto = ≥1 agente. El set del establecimiento (DAR) es la
  //    unión dedup de los agentes de todos los expuestos.
  const expuestos: RarExpuesto[] = [];
  const agentesEstablecimiento = new Map<string, RarAgenteRef>();

  for (const emp of empleados) {
    const puestos = puestosByEmpleado.get(emp.id) ?? [];
    const agentesEmp = new Map<string, RarAgenteRef>();
    for (const p of puestos) {
      for (const ag of agentesByPuesto.get(p.puestoId) ?? []) {
        agentesEmp.set(ag.agente_id, ag);
        agentesEstablecimiento.set(ag.agente_id, ag);
      }
    }
    if (agentesEmp.size === 0) continue;

    expuestos.push({
      empleado_id: emp.id,
      apellido: emp.apellido,
      nombre: emp.nombre,
      cuil: emp.cuil,
      dni: emp.dni,
      fecha_ingreso: emp.fecha_ingreso,
      puestos: puestos.map((p) => p.nombre),
      agentes: sortAgentes([...agentesEmp.values()]),
      faltan_datos: !emp.cuil || !emp.fecha_ingreso,
    });
  }

  return {
    expuestos,
    agentes: sortAgentes([...agentesEstablecimiento.values()]),
  };
}
