import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ClienteRow = Database['public']['Tables']['clientes']['Row'];

/**
 * Shape devuelto por `searchClientesByRazonSocial` (autocomplete del wizard
 * de informes T-050). Incluye los 5 campos que el autocomplete autopopula
 * en el form del informe (rgrl/relevamiento usan los 5; capacitacion/accidente
 * usan razon_social+cuit+domicilio; otros usa solo razon_social+cuit). Extender
 * el SELECT en T-050 (vs el shape mínimo id+razon_social+cuit de T-048) evita
 * un fetch N+1 al clickear un resultado del dropdown — costo trivial (~80
 * bytes extra por result × cap 10).
 */
export type ClienteSummary = Pick<
  ClienteRow,
  'id' | 'razon_social' | 'cuit' | 'domicilio' | 'localidad' | 'provincia'
>;

/**
 * Shape devuelto por `getInformesByClienteId` (sección "Informes vinculados"
 * del detail view T-050). Solo campos mostrables: titulo + tipo + status +
 * fecha. NO traemos `contenido` (puede pesar KBs).
 */
export type InformeLink = Pick<
  Database['public']['Tables']['informes']['Row'],
  'id' | 'tipo' | 'titulo' | 'status' | 'created_at'
>;

export type GetClientesOptions = {
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
};

/**
 * T-142 · Conteo de clientes activos del tenant (wizard de onboarding).
 * RLS filtra por `consultora_id` del claim. `head: true` evita traer filas.
 * Ante error devolvemos 0 (el wizard degrada al paso 1 "creá tu primer cliente").
 */
export async function countClientesActivos(supabase: SupabaseClient<Database>): Promise<number> {
  const { count, error } = await supabase
    .from('clientes')
    .select('id', { count: 'exact', head: true })
    .is('archived_at', null);
  if (error) return 0;
  return count ?? 0;
}

/**
 * Lista paginada de clientes del tenant del JWT.
 * RLS filtra automáticamente por `consultora_id`. NO recibimos `consultora_id`
 * como param — la fuente de verdad es el claim del JWT.
 */
export async function getClientesForConsultora(
  supabase: SupabaseClient<Database>,
  options: GetClientesOptions = {},
): Promise<ClienteRow[]> {
  const includeArchived = options.includeArchived ?? false;
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  let query = supabase
    .from('clientes')
    .select('*')
    .order('razon_social', { ascending: true })
    .order('id', { ascending: true });

  if (!includeArchived) {
    query = query.is('archived_at', null);
  }

  query = query.range(offset, offset + limit - 1);

  const { data } = await query;
  return data ?? [];
}

export async function getClienteById(
  supabase: SupabaseClient<Database>,
  clienteId: string,
): Promise<ClienteRow | null> {
  const { data } = await supabase.from('clientes').select('*').eq('id', clienteId).maybeSingle();
  return data ?? null;
}

/**
 * Autocomplete pre-T-050 (integración Clientes ↔ Informes).
 * Case-insensitive ILIKE sobre razón_social, solo clientes activos, cap 10.
 * Sanitiza wildcards `%` y `_` para evitar wildcard injection.
 * Returns `[]` si `q` trimmed tiene menos de 2 chars (UX: dropdown solo aparece
 * con 2+ chars para evitar queries innecesarios al tipear la 1ra letra).
 */
export async function searchClientesByRazonSocial(
  supabase: SupabaseClient<Database>,
  q: string,
): Promise<ClienteSummary[]> {
  const trimmed = q.trim().slice(0, 100);
  if (trimmed.length < 2) return [];

  // Escape orden importante: primero backslash, después % y _.
  const escaped = trimmed.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

  const { data } = await supabase
    .from('clientes')
    .select('id, razon_social, cuit, domicilio, localidad, provincia')
    .is('archived_at', null)
    .ilike('razon_social', `%${escaped}%`)
    .order('razon_social', { ascending: true })
    .limit(10);

  return data ?? [];
}

/**
 * T-050 · Informes vinculados al cliente (reverse lookup desde detail view).
 *
 * Cap 50 hard (defensa contra clientes con muchos informes históricos); la UI
 * corta a 10 (sin "Ver todos →" link — follow-up T-050-FU2 cuando aparezca
 * el filter `/informes?cliente_id=X`).
 *
 * RLS de `informes` filtra automáticamente cross-tenant. NO recibimos
 * `consultora_id` como param — la fuente de verdad es el JWT.
 */
export async function getInformesByClienteId(
  supabase: SupabaseClient<Database>,
  clienteId: string,
): Promise<InformeLink[]> {
  const { data } = await supabase
    .from('informes')
    .select('id, tipo, titulo, status, created_at')
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: false })
    .limit(50);
  return data ?? [];
}
