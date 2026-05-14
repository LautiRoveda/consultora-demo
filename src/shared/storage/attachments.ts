import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

import { BUCKET_INFORME_ATTACHMENTS, SIGNED_URL_TTL_PDF_RENDER_SEC } from './types';

/**
 * T-024 · Helpers de Storage para bucket informe-attachments.
 *
 * Convenciones:
 *  - El cliente Supabase usado para upload/delete debe ser el SERVICE-ROLE
 *    (creado en src/shared/supabase/service-role.ts). Las storage policies
 *    actuan como segunda barrera; el server action ya valido permission gate
 *    antes de llegar aca.
 *  - Para createSignedUrl SI usamos el cliente del USER (RLS gate via storage
 *    policy SELECT). De ese modo cualquier intento de leer un objeto cross-
 *    tenant es denegado por las policies, no por el server action.
 *
 * Operaciones expuestas:
 *  - uploadAttachmentToStorage: subida del binario al bucket.
 *  - deleteAttachmentFromStorage: borrar 1 objeto.
 *  - deleteAttachmentsBulk: borrar N objetos (cleanup de informe completo).
 *  - createSignedAttachmentUrl: signed URL para download/render PDF.
 */

type AnyClient = SupabaseClient<Database>;

export async function uploadAttachmentToStorage(
  admin: AnyClient,
  args: {
    path: string;
    bytes: Buffer | Uint8Array;
    contentType: string;
  },
): Promise<{ error: Error | null }> {
  const { error } = await admin.storage
    .from(BUCKET_INFORME_ATTACHMENTS)
    .upload(args.path, args.bytes, {
      contentType: args.contentType,
      cacheControl: '3600',
      upsert: false,
    });
  return { error: error ? new Error(error.message) : null };
}

export async function deleteAttachmentFromStorage(
  admin: AnyClient,
  path: string,
): Promise<{ error: Error | null }> {
  const { error } = await admin.storage.from(BUCKET_INFORME_ATTACHMENTS).remove([path]);
  return { error: error ? new Error(error.message) : null };
}

export async function deleteAttachmentsBulk(
  admin: AnyClient,
  paths: string[],
): Promise<{ error: Error | null }> {
  if (paths.length === 0) return { error: null };
  const { error } = await admin.storage.from(BUCKET_INFORME_ATTACHMENTS).remove(paths);
  return { error: error ? new Error(error.message) : null };
}

export async function createSignedAttachmentUrl(
  supabase: AnyClient,
  path: string,
  ttlSec: number = SIGNED_URL_TTL_PDF_RENDER_SEC,
): Promise<{ signedUrl: string | null; error: Error | null }> {
  const { data, error } = await supabase.storage
    .from(BUCKET_INFORME_ATTACHMENTS)
    .createSignedUrl(path, ttlSec);
  if (error || !data) {
    return {
      signedUrl: null,
      error: error ? new Error(error.message) : new Error('no_signed_url'),
    };
  }
  return { signedUrl: data.signedUrl, error: null };
}

export async function createSignedAttachmentUrls(
  supabase: AnyClient,
  paths: string[],
  ttlSec: number = SIGNED_URL_TTL_PDF_RENDER_SEC,
): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map();
  const { data } = await supabase.storage
    .from(BUCKET_INFORME_ATTACHMENTS)
    .createSignedUrls(paths, ttlSec);
  const out = new Map<string, string>();
  if (!data) return out;
  for (const row of data) {
    if (row.path && row.signedUrl) out.set(row.path, row.signedUrl);
  }
  return out;
}
