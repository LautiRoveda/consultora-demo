import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

import { normalizeDni } from '@/shared/templates/common/dni';

export type EmpleadoRow = Database['public']['Tables']['empleados']['Row'];

/**
 * Shape devuelto por `searchEmpleadosByNombre` y `searchEmpleadosByDni`.
 * 6 fields (id + datos visibles del dropdown) para evitar fetch N+1 al click
 * en autocompletes futuros (T-055 tab Empleados + T-058 EPP planilla).
 */
export type EmpleadoSummary = Pick<
  EmpleadoRow,
  'id' | 'nombre' | 'apellido' | 'dni' | 'cuil' | 'puesto'
>;

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
 * Autocomplete por apellido o nombre. Pre-requisito de T-055 (tab Empleados)
 * y T-058 (EPP planilla Res 299/11).
 *
 * Case-insensitive ILIKE sobre apellido + nombre (con OR), solo empleados
 * activos, cap 10. Sanitiza wildcards `%` y `_` para evitar wildcard injection.
 * Returns `[]` si `q` trimmed tiene menos de 2 chars (UX: dropdown solo aparece
 * con 2+ chars para evitar queries innecesarios al tipear la 1ra letra).
 */
export async function searchEmpleadosByNombre(
  supabase: SupabaseClient<Database>,
  q: string,
): Promise<EmpleadoSummary[]> {
  const trimmed = q.trim().slice(0, 100);
  if (trimmed.length < 2) return [];

  // Escape orden importante: primero backslash, después % y _.
  const escaped = trimmed.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

  const { data } = await supabase
    .from('empleados')
    .select('id, nombre, apellido, dni, cuil, puesto')
    .is('archived_at', null)
    .or(`apellido.ilike.%${escaped}%,nombre.ilike.%${escaped}%`)
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
    .select('id, nombre, apellido, dni, cuil, puesto')
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
    .select('id, nombre, apellido, dni, cuil, puesto')
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
