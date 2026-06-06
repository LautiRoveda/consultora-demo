import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Turn } from './schema';

/** Item del sidebar de conversaciones. */
export type ChatConversacionListItem = {
  id: string;
  titulo: string;
  updatedAt: string;
};

/**
 * T-126 · Lista de conversaciones activas del usuario para el sidebar.
 *
 * Privadas: la RLS filtra por `user_id = auth.uid()` + consultora (no recibimos
 * consultora_id como param — la fuente es el JWT). Ordena por actividad reciente.
 *
 * R2 (RFC T-126): filtra a conversaciones con >=1 mensaje para que una conversación
 * huérfana (creada pero sin mensajes por un fallo parcial del action) no aparezca
 * en el sidebar. Trae el `count` embebido (no las filas) y filtra en JS — barato
 * con el cap de 50. (El RPC transaccional create+insert queda como follow-up.)
 */
export async function getChatConversaciones(
  supabase: SupabaseClient<Database>,
): Promise<ChatConversacionListItem[]> {
  const { data } = await supabase
    .from('chat_conversaciones')
    .select('id, titulo, updated_at, chat_mensajes(count)')
    .is('archived_at', null)
    .order('updated_at', { ascending: false })
    .limit(50);

  return (data ?? [])
    .filter((c) => {
      const embedded = c.chat_mensajes as unknown as Array<{ count: number }> | null;
      return (embedded?.[0]?.count ?? 0) > 0;
    })
    .map((c) => ({ id: c.id, titulo: c.titulo, updatedAt: c.updated_at }));
}

/**
 * T-126 · Mensajes de una conversación, en orden.
 *
 * Ordena por `seq` (NO por created_at: los 2 mensajes de un turno comparten now()).
 * La RLS oculta conversaciones ajenas -> devuelve [] si no es del usuario / no existe.
 * El shape ya coincide con `Turn` (el `role` es text con CHECK in ('user','assistant')).
 */
export async function getChatMensajes(
  supabase: SupabaseClient<Database>,
  conversacionId: string,
): Promise<Turn[]> {
  const { data } = await supabase
    .from('chat_mensajes')
    .select('role, content')
    .eq('conversacion_id', conversacionId)
    .order('seq', { ascending: true });

  return (data ?? []).map((m) => ({ role: m.role as Turn['role'], content: m.content }));
}
