import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

import { normalizeDni } from '@/shared/templates/common/dni';

import { sanitizeNombreSearchTerm } from './search-term';

export type EmpleadoRow = Database['public']['Tables']['empleados']['Row'];

/**
 * Shape devuelto por `searchEmpleadosByNombre` y `searchEmpleadosByDni`.
 * 5 fields (id + datos visibles del dropdown) para evitar fetch N+1 al click
 * en autocompletes futuros (T-055 tab Empleados + T-058 EPP planilla).
 *
 * T-129: el puesto NO va en el summary — se derivó a `getEmpleadoPuestosLabel`
 * (catálogo) y los consumidores que lo necesitan lo piden aparte. Los
 * autocompletes desambiguan por nombre + DNI.
 */
export type EmpleadoSummary = Pick<EmpleadoRow, 'id' | 'nombre' | 'apellido' | 'dni' | 'cuil'>;

export type GetEmpleadosByClienteOptions = {
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
};

/**
 * Lista paginada de empleados de un cliente.
 * RLS filtra `consultora_id` automáticamente — NO recibimos consultora_id como
 * param (fuente de verdad es el JWT claim).
 */
export async function getEmpleadosByCliente(
  supabase: SupabaseClient<Database>,
  clienteId: string,
  options: GetEmpleadosByClienteOptions = {},
): Promise<EmpleadoRow[]> {
  const includeArchived = options.includeArchived ?? false;
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  let query = supabase
    .from('empleados')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('apellido', { ascending: true })
    .order('nombre', { ascending: true })
    .order('id', { ascending: true });

  if (!includeArchived) {
    query = query.is('archived_at', null);
  }

  query = query.range(offset, offset + limit - 1);

  const { data } = await query;
  return data ?? [];
}

export async function getEmpleadoById(
  supabase: SupabaseClient<Database>,
  empleadoId: string,
): Promise<EmpleadoRow | null> {
  const { data } = await supabase.from('empleados').select('*').eq('id', empleadoId).maybeSingle();
  return data ?? null;
}

/**
 * T-129 · Label canónico de los puestos del empleado desde el CATÁLOGO
 * (`empleados_puestos` → `puestos`). Devuelve los nombres VIGENTES (excluye
 * archivados) concatenados con ", " (más reciente primero por `asignado_at`), o
 * `null` si el empleado no tiene puestos activos asignados.
 *
 * Single-empleado: los consumers (informe de accidente + planilla EPP) son de a
 * uno → 1 query por llamada, sin N+1. RLS filtra cross-tenant. Cap 20 (empleado
 * típico tiene 1-3 puestos). Sin dedupe: el índice único parcial del catálogo
 * impide dos puestos activos con el mismo nombre por consultora.
 */
export async function getEmpleadoPuestosLabel(
  supabase: SupabaseClient<Database>,
  empleadoId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('empleados_puestos')
    .select('asignado_at, puestos!inner(nombre, archived_at)')
    .eq('empleado_id', empleadoId)
    .order('asignado_at', { ascending: false })
    .limit(20);

  if (!data) return null;

  const nombres = data.filter((r) => r.puestos.archived_at === null).map((r) => r.puestos.nombre);
  return nombres.length ? nombres.join(', ') : null;
}

/**
 * Autocomplete por apellido o nombre. Pre-requisito de T-055 (tab Empleados)
 * y T-058 (EPP planilla Res 299/11).
 *
 * Case-insensitive ILIKE sobre apellido + nombre (con OR), solo empleados
 * activos, cap 10. T-134: el término pasa por `sanitizeNombreSearchTerm` antes
 * de interpolarse — el `.or()` recibe un string CRUDO de sintaxis PostgREST
 * (`,` `(` `)` `"` son estructurales, ≠ `.ilike()` parametrizado), así que se
 * restringe a charset name-safe para que no pueda aportar sintaxis.
 * Returns `[]` si el término SANEADO tiene menos de 2 chars (UX: dropdown solo
 * aparece con 2+ chars para evitar queries innecesarios al tipear la 1ra letra;
 * el guard corre post-saneo para que ",a" no llegue a la query).
 */
export async function searchEmpleadosByNombre(
  supabase: SupabaseClient<Database>,
  q: string,
): Promise<EmpleadoSummary[]> {
  const term = sanitizeNombreSearchTerm(q);
  if (term.length < 2) return [];

  const { data } = await supabase
    .from('empleados')
    .select('id, nombre, apellido, dni, cuil')
    .is('archived_at', null)
    .or(`apellido.ilike.%${term}%,nombre.ilike.%${term}%`)
    .order('apellido', { ascending: true })
    .order('nombre', { ascending: true })
    .limit(10);

  return data ?? [];
}

/**
 * Autocomplete por DNI (caso real consultor: "solo me acuerdo del DNI").
 *
 * Strip dots/spaces/dashes del input → prefix match sobre `dni` (digits-only
 * en DB matcheando CHECK `^\d{7,8}$`). Cap 8 dígitos (DNI max). Returns `[]`
 * si menos de 3 dígitos (UX guard: dropdown solo aparece después de 3 chars).
 */
export async function searchEmpleadosByDni(
  supabase: SupabaseClient<Database>,
  q: string,
): Promise<EmpleadoSummary[]> {
  const digits = normalizeDni(q).slice(0, 8);
  if (digits.length < 3) return [];
  if (!/^\d+$/.test(digits)) return [];

  const { data } = await supabase
    .from('empleados')
    .select('id, nombre, apellido, dni, cuil')
    .is('archived_at', null)
    .ilike('dni', `${digits}%`)
    .order('dni', { ascending: true })
    .limit(10);

  return data ?? [];
}

/**
 * Normaliza un string para comparación de búsqueda: lowercase + sin tildes
 * (NFD + strip de marcas diacríticas combinantes U+0300–U+036F). Se aplica igual
 * al query y a los campos del empleado, así "Pérez" matchea "perez".
 */
function normalizeForSearch(value: string): string {
  return (
    value
      .normalize('NFD')
      // \p{Diacritic} (ASCII puro, diff-safe) cubre las marcas combinantes Unicode
      // U+0300–U+036F que produce NFD; evita meter caracteres combinantes literales
      // en el source (se corrompen al pegar/editar y quedan invisibles en el diff).
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim()
  );
}

/**
 * T-117-FU1 · Búsqueda de empleados para el ASISTENTE IA (NO para autocompletes).
 * `searchEmpleadosByNombre`/`ByDni` siguen sirviendo al tab Empleados y a la
 * planilla EPP — no las toques.
 *
 * Multi-término: cada palabra del query debe aparecer en nombre O apellido (AND
 * entre palabras) → "lautaro roveda", "roveda lautaro" y "juan perez" caen igual.
 * Accent- + case-insensitive (`normalizeForSearch`). Filtra en JS sobre el set
 * activo del tenant. RLS-aware (cross-tenant → []). Cap 10; mismo shape que las
 * otras búsquedas (`EmpleadoSummary`).
 */
export async function searchEmpleadosForChat(
  supabase: SupabaseClient<Database>,
  query: string,
): Promise<EmpleadoSummary[]> {
  const normalized = normalizeForSearch(query);
  // Guard: < 2 chars normalizados → evita match masivo por un token de 1 letra.
  if (normalized.replace(/\s/g, '').length < 2) return [];
  const tokens = normalized.split(/\s+/).filter(Boolean);

  // TECHO SILENCIOSO: traemos hasta 500 activos y filtramos en JS. Suficiente para
  // el MVP (50-300 empleados/tenant). Si un tenant supera 500 activos, la búsqueda
  // sólo mira los primeros 500 alfabéticos (por apellido, nombre) SIN avisar — ése
  // es el disparador del FU: RPC con public.unaccent (T-012) + índice funcional.
  const { data } = await supabase
    .from('empleados')
    .select('id, nombre, apellido, dni, cuil')
    .is('archived_at', null)
    .order('apellido', { ascending: true })
    .order('nombre', { ascending: true })
    .limit(500);
  if (!data) return [];

  return data
    .filter((e) => {
      const nombre = normalizeForSearch(e.nombre);
      const apellido = normalizeForSearch(e.apellido);
      return tokens.every((t) => nombre.includes(t) || apellido.includes(t));
    })
    .slice(0, 10);
}
