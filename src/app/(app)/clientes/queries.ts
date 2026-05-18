import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ClienteRow = Database['public']['Tables']['clientes']['Row'];
export type ClienteSummary = Pick<ClienteRow, 'id' | 'razon_social' | 'cuit'>;

export type GetClientesOptions = {
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
};

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
    .select('id, razon_social, cuit')
    .is('archived_at', null)
    .ilike('razon_social', `%${escaped}%`)
    .order('razon_social', { ascending: true })
    .limit(10);

  return data ?? [];
}
