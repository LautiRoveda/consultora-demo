import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

import { logger } from '@/shared/observability/logger';

/**
 * T-024 · Queries server-only de attachments.
 *
 * RLS hace el scoping por consultora — el JWT del request limita lo que
 * `select` puede ver.
 */

type AttachmentRow = Database['public']['Tables']['informe_attachments']['Row'];

export async function getInformeAttachments(
  supabase: SupabaseClient<Database>,
  informeId: string,
): Promise<AttachmentRow[]> {
  const { data, error } = await supabase
    .from('informe_attachments')
    .select('*')
    .eq('informe_id', informeId)
    .order('kind', { ascending: true })
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    logger.error({ err: error, informeId }, 'getInformeAttachments: select fallo');
    return [];
  }
  return data ?? [];
}

export async function getInformeAttachmentById(
  supabase: SupabaseClient<Database>,
  attachmentId: string,
): Promise<AttachmentRow | null> {
  const { data, error } = await supabase
    .from('informe_attachments')
    .select('*')
    .eq('id', attachmentId)
    .maybeSingle();

  if (error) {
    logger.error({ err: error, attachmentId }, 'getInformeAttachmentById: select fallo');
    return null;
  }
  return data;
}

export async function countInformeAttachments(
  supabase: SupabaseClient<Database>,
  informeId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('informe_attachments')
    .select('*', { count: 'exact', head: true })
    .eq('informe_id', informeId);

  if (error) {
    logger.error({ err: error, informeId }, 'countInformeAttachments: count fallo');
    return 0;
  }
  return count ?? 0;
}
