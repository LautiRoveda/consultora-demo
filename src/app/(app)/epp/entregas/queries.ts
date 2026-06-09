import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getEmpleadoPuestosLabel } from '@/app/(app)/empleados/queries';
import { createSignedEppFirmaUrl } from '@/shared/storage/epp-firmas';

export type EntregaRow = Database['public']['Tables']['epp_entregas']['Row'];
export type EntregaItemRow = Database['public']['Tables']['epp_entrega_items']['Row'];
export type PlanificacionRow = Database['public']['Tables']['epp_planificaciones']['Row'];
export type ItemCatalogRow = Database['public']['Tables']['epp_items']['Row'];

export type EntregaListItem = {
  id: string;
  fecha_entrega: string;
  firmado_at: string | null;
  empleado_id: string;
  empleado_nombre: string;
  empleado_apellido: string;
  cliente_id: string;
  cliente_razon_social: string;
  items_count: number;
};

export type EntregaItemWithCatalog = EntregaItemRow & {
  item_nombre: string;
  item_es_descartable: boolean;
  item_requiere_numero_serie: boolean;
  item_vida_util_meses: number;
};

export type EntregaDetail = EntregaRow & {
  empleado: { id: string; nombre: string; apellido: string; dni: string | null } | null;
  cliente: { id: string; razon_social: string } | null;
  items: EntregaItemWithCatalog[];
};

export type EntregaItemForPlanilla = EntregaItemRow & {
  item_nombre: string;
  item_normativa: string | null;
  categoria_nombre: string;
};

export type EntregaForPlanilla = EntregaRow & {
  empleado: {
    id: string;
    nombre: string;
    apellido: string;
    dni: string | null;
    cuil: string | null;
    fecha_ingreso: string | null;
  } | null;
  /** T-129: puestos vigentes del catálogo concatenados (reemplaza `empleado.puesto`). */
  puestos_label: string | null;
  cliente: {
    id: string;
    razon_social: string;
    cuit: string;
    nombre_fantasia: string | null;
    domicilio: string | null;
    localidad: string | null;
    provincia: string | null;
  } | null;
  items: EntregaItemForPlanilla[];
};

export type PlanificacionWithEvent = PlanificacionRow & {
  item_nombre: string | null;
  calendar_event_titulo: string | null;
  calendar_event_fecha_vencimiento: string | null;
};

// T-109 · Timeline de entregas EPP de un empleado (ficha /empleados/[id]).
export type EntregaTimelineItemDetail = {
  id: string;
  cantidad: number;
  motivo_entrega: EntregaItemRow['motivo_entrega'];
  numero_serie: string | null;
  item_nombre: string;
  categoria_nombre: string;
};

export type EntregaTimelineEntry = {
  id: string;
  fecha_entrega: string;
  firmado_at: string | null;
  observaciones: string | null;
  items: EntregaTimelineItemDetail[];
};

// T-109 · Próximos vencimientos EPP de un empleado (planificaciones activas).
export type PlanificacionActivaEmpleado = {
  id: string;
  item_id: string;
  item_nombre: string;
  fecha_proxima_entrega: string;
  frecuencia_meses: number;
  calendar_event_id: string | null;
};

type ListOptions = {
  empleadoId?: string;
  clienteId?: string;
  includeUnsigned?: boolean;
  limit?: number;
};

const DEFAULT_LIST_LIMIT = 50;

/**
 * Lista entregas EPP del tenant con conteo de items + datos básicos de empleado
 * y cliente para render de cards. Cap default 50, sin paginación inicial (MVP).
 *
 * RLS filtra cross-tenant automáticamente — `consultora_id` no se pasa por param.
 */
export async function listEntregasByConsultora(
  supabase: SupabaseClient<Database>,
  options: ListOptions = {},
): Promise<EntregaListItem[]> {
  const limit = options.limit ?? DEFAULT_LIST_LIMIT;

  let query = supabase
    .from('epp_entregas')
    .select(
      'id, fecha_entrega, firmado_at, empleado_id, cliente_id, ' +
        'empleado:empleados!inner(id, nombre, apellido), ' +
        'cliente:clientes!inner(id, razon_social), ' +
        'items:epp_entrega_items(id)',
    )
    .order('fecha_entrega', { ascending: false })
    .limit(limit);

  if (options.empleadoId) query = query.eq('empleado_id', options.empleadoId);
  if (options.clienteId) query = query.eq('cliente_id', options.clienteId);
  if (!options.includeUnsigned) query = query.not('firmado_at', 'is', null);

  const { data } = await query;
  if (!data) return [];

  return data.map((row) => {
    const r = row as unknown as {
      id: string;
      fecha_entrega: string;
      firmado_at: string | null;
      empleado_id: string;
      cliente_id: string;
      empleado: { id: string; nombre: string; apellido: string } | null;
      cliente: { id: string; razon_social: string } | null;
      items: Array<{ id: string }> | null;
    };
    return {
      id: r.id,
      fecha_entrega: r.fecha_entrega,
      firmado_at: r.firmado_at,
      empleado_id: r.empleado_id,
      empleado_nombre: r.empleado?.nombre ?? '—',
      empleado_apellido: r.empleado?.apellido ?? '—',
      cliente_id: r.cliente_id,
      cliente_razon_social: r.cliente?.razon_social ?? '—',
      items_count: r.items?.length ?? 0,
    };
  });
}

/**
 * Fetch detalle completo de una entrega para detail page read-only.
 * Incluye JOIN epp_items para mostrar nombre + flags. RLS-aware.
 */
export async function getEntregaById(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<EntregaDetail | null> {
  const { data: entrega } = await supabase
    .from('epp_entregas')
    .select(
      '*, ' +
        'empleado:empleados!inner(id, nombre, apellido, dni), ' +
        'cliente:clientes!inner(id, razon_social)',
    )
    .eq('id', id)
    .maybeSingle();

  if (!entrega) return null;

  const { data: itemsRaw } = await supabase
    .from('epp_entrega_items')
    .select(
      '*, ' +
        'item:epp_items!inner(nombre, es_descartable, requiere_numero_serie, vida_util_meses)',
    )
    .eq('entrega_id', id)
    .order('created_at', { ascending: true });

  const items: EntregaItemWithCatalog[] = (itemsRaw ?? []).map((row) => {
    const r = row as unknown as EntregaItemRow & {
      item: {
        nombre: string;
        es_descartable: boolean;
        requiere_numero_serie: boolean;
        vida_util_meses: number;
      } | null;
    };
    const { item, ...rest } = r;
    return {
      ...rest,
      item_nombre: item?.nombre ?? '—',
      item_es_descartable: item?.es_descartable ?? false,
      item_requiere_numero_serie: item?.requiere_numero_serie ?? false,
      item_vida_util_meses: item?.vida_util_meses ?? 0,
    };
  });

  const e = entrega as unknown as EntregaRow & {
    empleado: { id: string; nombre: string; apellido: string; dni: string | null } | null;
    cliente: { id: string; razon_social: string } | null;
  };

  const { empleado, cliente, ...rest } = e;
  return {
    ...rest,
    empleado,
    cliente,
    items,
  };
}

/**
 * T-104 · Fetch detalle ampliado para la Planilla Res SRT 299/11.
 *
 * Mismo flow que `getEntregaById` pero con campos adicionales requeridos por
 * la planilla legal: CUIT/domicilio/localidad/provincia del cliente,
 * CUIL/fecha_ingreso del empleado, los puestos del catálogo (T-129) y
 * normativa/categoría de cada item del catálogo.
 *
 * RLS-aware. Cross-tenant entrega → null.
 */
export async function getEntregaForPlanilla(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<EntregaForPlanilla | null> {
  const { data: entrega } = await supabase
    .from('epp_entregas')
    .select(
      '*, ' +
        'empleado:empleados!inner(id, nombre, apellido, dni, cuil, fecha_ingreso), ' +
        'cliente:clientes!inner(id, razon_social, cuit, nombre_fantasia, domicilio, localidad, provincia)',
    )
    .eq('id', id)
    .maybeSingle();

  if (!entrega) return null;

  const { data: itemsRaw } = await supabase
    .from('epp_entrega_items')
    .select(
      '*, ' + 'item:epp_items!inner(nombre, normativa, categoria:epp_categorias!inner(nombre))',
    )
    .eq('entrega_id', id)
    .order('created_at', { ascending: true });

  const items: EntregaItemForPlanilla[] = (itemsRaw ?? []).map((row) => {
    const r = row as unknown as EntregaItemRow & {
      item: {
        nombre: string;
        normativa: string | null;
        categoria: { nombre: string } | null;
      } | null;
    };
    const { item, ...rest } = r;
    return {
      ...rest,
      item_nombre: item?.nombre ?? '—',
      item_normativa: item?.normativa ?? null,
      categoria_nombre: item?.categoria?.nombre ?? '—',
    };
  });

  const e = entrega as unknown as EntregaRow & {
    empleado: EntregaForPlanilla['empleado'];
    cliente: EntregaForPlanilla['cliente'];
  };

  const { empleado, cliente, ...rest } = e;

  // T-129: puesto desde el catálogo (concatenado) en vez de `empleado.puesto`.
  // Single-empleado → 1 query extra, sin N+1.
  const puestos_label = empleado ? await getEmpleadoPuestosLabel(supabase, empleado.id) : null;

  return {
    ...rest,
    empleado,
    cliente,
    puestos_label,
    items,
  };
}

/**
 * Wrapper conveniente sobre createSignedEppFirmaUrl. Default TTL 1h (UI).
 */
export async function getSignedUrlForFirma(
  supabase: SupabaseClient<Database>,
  storagePath: string,
  ttlSec?: number,
): Promise<string | null> {
  const { signedUrl } = await createSignedEppFirmaUrl(supabase, storagePath, ttlSec);
  return signedUrl;
}

/**
 * Lista planificaciones generadas por una entrega + datos del calendar_event
 * asociado para que el detail page muestre fecha próxima + título visible en
 * `/calendario`.
 */
export async function listPlanificacionesByEntrega(
  supabase: SupabaseClient<Database>,
  entregaId: string,
): Promise<PlanificacionWithEvent[]> {
  const { data } = await supabase
    .from('epp_planificaciones')
    .select(
      '*, ' +
        'item:epp_items!inner(nombre), ' +
        'calendar_event:calendar_events(titulo, fecha_vencimiento)',
    )
    .eq('generado_de_entrega_id', entregaId)
    .order('fecha_proxima_entrega', { ascending: true });

  if (!data) return [];

  return data.map((row) => {
    const r = row as unknown as PlanificacionRow & {
      item: { nombre: string } | null;
      calendar_event: { titulo: string; fecha_vencimiento: string } | null;
    };
    const { item, calendar_event, ...rest } = r;
    return {
      ...rest,
      item_nombre: item?.nombre ?? null,
      calendar_event_titulo: calendar_event?.titulo ?? null,
      calendar_event_fecha_vencimiento: calendar_event?.fecha_vencimiento ?? null,
    };
  });
}

/**
 * Cuenta entregas (firmadas + pendientes) y empleados activos del tenant.
 * Usado por /epp/entregas/nueva para decidir si renderear el wizard o el
 * empty state CTA.
 */
export async function countEntregasContext(
  supabase: SupabaseClient<Database>,
  consultoraId: string,
): Promise<{ entregas: number; empleados: number; items: number }> {
  const [entRes, empRes, itemRes] = await Promise.all([
    supabase
      .from('epp_entregas')
      .select('*', { count: 'exact', head: true })
      .eq('consultora_id', consultoraId),
    supabase
      .from('empleados')
      .select('*', { count: 'exact', head: true })
      .eq('consultora_id', consultoraId)
      .is('archived_at', null),
    supabase
      .from('epp_items')
      .select('*', { count: 'exact', head: true })
      .eq('consultora_id', consultoraId)
      .is('archived_at', null),
  ]);

  return {
    entregas: entRes.count ?? 0,
    empleados: empRes.count ?? 0,
    items: itemRes.count ?? 0,
  };
}

/**
 * Lista empleados activos del tenant con datos mínimos para el select del
 * wizard step 1. Cap 500 (suficiente para un consultor MVP con 5-20 clientes
 * × ~20 empleados promedio).
 */
export async function listEmpleadosForEntregaWizard(supabase: SupabaseClient<Database>): Promise<
  Array<{
    id: string;
    nombre: string;
    apellido: string;
    dni: string | null;
    cliente_id: string;
    cliente_razon_social: string;
  }>
> {
  const { data } = await supabase
    .from('empleados')
    .select('id, nombre, apellido, dni, cliente_id, cliente:clientes!inner(razon_social)')
    .is('archived_at', null)
    .order('apellido', { ascending: true })
    .order('nombre', { ascending: true })
    .limit(500);

  if (!data) return [];

  return data.map((row) => {
    const r = row as unknown as {
      id: string;
      nombre: string;
      apellido: string;
      dni: string | null;
      cliente_id: string;
      cliente: { razon_social: string } | null;
    };
    return {
      id: r.id,
      nombre: r.nombre,
      apellido: r.apellido,
      dni: r.dni,
      cliente_id: r.cliente_id,
      cliente_razon_social: r.cliente?.razon_social ?? '—',
    };
  });
}

/**
 * Lista items activos del catalogo con datos para el wizard step 2 (select
 * + render condicional de numero_serie).
 */
export async function listItemsForEntregaWizard(supabase: SupabaseClient<Database>): Promise<
  Array<{
    id: string;
    nombre: string;
    es_descartable: boolean;
    requiere_numero_serie: boolean;
    vida_util_meses: number;
    marca_default: string | null;
    modelo_default: string | null;
    categoria_nombre: string;
  }>
> {
  const { data } = await supabase
    .from('epp_items')
    .select(
      'id, nombre, es_descartable, requiere_numero_serie, vida_util_meses, marca_default, modelo_default, ' +
        'categoria:epp_categorias!inner(nombre)',
    )
    .is('archived_at', null)
    .order('nombre', { ascending: true });

  if (!data) return [];

  return data.map((row) => {
    const r = row as unknown as {
      id: string;
      nombre: string;
      es_descartable: boolean;
      requiere_numero_serie: boolean;
      vida_util_meses: number;
      marca_default: string | null;
      modelo_default: string | null;
      categoria: { nombre: string } | null;
    };
    return {
      id: r.id,
      nombre: r.nombre,
      es_descartable: r.es_descartable,
      requiere_numero_serie: r.requiere_numero_serie,
      vida_util_meses: r.vida_util_meses,
      marca_default: r.marca_default,
      modelo_default: r.modelo_default,
      categoria_nombre: r.categoria?.nombre ?? '—',
    };
  });
}

type EntregasByEmpleadoOptions = {
  limit?: number;
  offset?: number;
  includeUnsigned?: boolean;
};

const DEFAULT_TIMELINE_LIMIT = 20;

/**
 * T-109 · Timeline cronológica de entregas EPP de UN empleado para la sección
 * "Entregas EPP" de la ficha /empleados/[id].
 *
 * Un solo select anidado (epp_entregas -> epp_entrega_items -> epp_items ->
 * epp_categorias) evita N+1: traemos cada entrega con sus items y el
 * nombre + categoría de cada item en un único round-trip.
 *
 * RLS-aware: NO recibimos `consultora_id`; las policies del tenant filtran. Un
 * `empleadoId` de otro tenant devuelve [] (ninguna fila visible) — defensa
 * cross-tenant sin chequeo extra. Aprovecha el índice
 * idx_epp_entregas_empleado_fecha (empleado_id, fecha_entrega desc).
 *
 * Default firmadas-only (firmado_at not null): el timeline muestra evidencia
 * legal cerrada (Res SRT 299/11), no drafts. `includeUnsigned` para preview.
 * Paginada via `range`; default 20 por página (la ficha rara vez necesita más).
 */
export async function getEntregasByEmpleado(
  supabase: SupabaseClient<Database>,
  empleadoId: string,
  options: EntregasByEmpleadoOptions = {},
): Promise<EntregaTimelineEntry[]> {
  const limit = options.limit ?? DEFAULT_TIMELINE_LIMIT;
  const offset = options.offset ?? 0;

  let query = supabase
    .from('epp_entregas')
    .select(
      'id, fecha_entrega, firmado_at, observaciones, ' +
        'items:epp_entrega_items(id, cantidad, motivo_entrega, numero_serie, created_at, ' +
        'item:epp_items!inner(nombre, categoria:epp_categorias!inner(nombre)))',
    )
    .eq('empleado_id', empleadoId)
    .order('fecha_entrega', { ascending: false })
    .range(offset, offset + limit - 1);

  if (!options.includeUnsigned) query = query.not('firmado_at', 'is', null);

  const { data } = await query;
  if (!data) return [];

  return data.map((row) => {
    const r = row as unknown as {
      id: string;
      fecha_entrega: string;
      firmado_at: string | null;
      observaciones: string | null;
      items: Array<{
        id: string;
        cantidad: number;
        motivo_entrega: EntregaItemRow['motivo_entrega'];
        numero_serie: string | null;
        created_at: string;
        item: { nombre: string; categoria: { nombre: string } | null } | null;
      }> | null;
    };
    // El embed no garantiza orden de los items dentro de la entrega; los
    // ordenamos por created_at asc (orden de carga en el wizard) para un
    // render estable. Costo trivial: pocos items por entrega.
    const items: EntregaTimelineItemDetail[] = (r.items ?? [])
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((it) => ({
        id: it.id,
        cantidad: it.cantidad,
        motivo_entrega: it.motivo_entrega,
        numero_serie: it.numero_serie,
        item_nombre: it.item?.nombre ?? '—',
        categoria_nombre: it.item?.categoria?.nombre ?? '—',
      }));
    return {
      id: r.id,
      fecha_entrega: r.fecha_entrega,
      firmado_at: r.firmado_at,
      observaciones: r.observaciones,
      items,
    };
  });
}

/**
 * T-109 · Planificaciones EPP activas de UN empleado (próximos vencimientos)
 * para la ficha /empleados/[id]. Orden asc por fecha_proxima_entrega (lo más
 * próximo a vencer primero).
 *
 * RLS-aware (cross-tenant -> []). `estado='activa'` descarta cumplidas y
 * canceladas. Aprovecha idx_epp_planificaciones_empleado (empleado_id, estado).
 */
export async function getPlanificacionesActivasByEmpleado(
  supabase: SupabaseClient<Database>,
  empleadoId: string,
): Promise<PlanificacionActivaEmpleado[]> {
  const { data } = await supabase
    .from('epp_planificaciones')
    .select(
      'id, item_id, fecha_proxima_entrega, frecuencia_meses, calendar_event_id, ' +
        'item:epp_items!inner(nombre)',
    )
    .eq('empleado_id', empleadoId)
    .eq('estado', 'activa')
    .order('fecha_proxima_entrega', { ascending: true });

  if (!data) return [];

  return data.map((row) => {
    const r = row as unknown as {
      id: string;
      item_id: string;
      fecha_proxima_entrega: string;
      frecuencia_meses: number;
      calendar_event_id: string | null;
      item: { nombre: string } | null;
    };
    return {
      id: r.id,
      item_id: r.item_id,
      item_nombre: r.item?.nombre ?? '—',
      fecha_proxima_entrega: r.fecha_proxima_entrega,
      frecuencia_meses: r.frecuencia_meses,
      calendar_event_id: r.calendar_event_id,
    };
  });
}
