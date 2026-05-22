import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export type SuscripcionRow = Database['public']['Tables']['suscripciones']['Row'];
export type FacturaRow = Database['public']['Tables']['facturas']['Row'];

/**
 * Suscripcion "actual" del tenant del JWT. Tomamos la última creada — el
 * patrón normal es: una sola fila activa por consultora, pero el lifecycle
 * permite múltiples (trial → cancelled → re-subscribe crea una nueva).
 * Filtro `archived_at IS NULL` no aplica acá (no hay soft-delete en
 * suscripciones, T-070).
 *
 * RLS filtra por consultora_id automáticamente.
 */
export async function getActiveSubscription(
  supabase: SupabaseClient<Database>,
): Promise<SuscripcionRow | null> {
  const { data, error } = await supabase
    .from('suscripciones')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`getActiveSubscription: ${error.message}`);
  }
  return data ?? null;
}

export interface GetInvoicesOptions {
  limit?: number;
  offset?: number;
}

/**
 * Lista paginada de facturas del tenant del JWT. Más recientes primero.
 * RLS filtra por consultora_id automáticamente.
 */
export async function getInvoicesForConsultora(
  supabase: SupabaseClient<Database>,
  options: GetInvoicesOptions = {},
): Promise<FacturaRow[]> {
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;

  const { data, error } = await supabase
    .from('facturas')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(`getInvoicesForConsultora: ${error.message}`);
  }
  return data ?? [];
}
