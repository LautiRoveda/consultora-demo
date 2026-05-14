import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

import { BUCKET_CONSULTORA_LOGOS, SIGNED_URL_TTL_PDF_RENDER_SEC } from './types';

/**
 * T-024 · Helpers de Storage para bucket consultora-logos.
 *
 * Mismo patron que attachments.ts: writes via SERVICE-ROLE (gated por el
 * server action), reads via USER client (gated por storage policy SELECT).
 *
 * 1 logo activo por consultora. Al subir uno nuevo, server action borra el
 * anterior antes de update del registro `consultoras.logo_storage_path`.
 */

type AnyClient = SupabaseClient<Database>;

export async function uploadLogoToStorage(
  admin: AnyClient,
  args: {
    path: string;
    bytes: Buffer | Uint8Array;
    contentType: string;
  },
): Promise<{ error: Error | null }> {
  const { error } = await admin.storage
    .from(BUCKET_CONSULTORA_LOGOS)
    .upload(args.path, args.bytes, {
      contentType: args.contentType,
      cacheControl: '3600',
      upsert: false,
    });
  return { error: error ? new Error(error.message) : null };
}

export async function deleteLogoFromStorage(
  admin: AnyClient,
  path: string,
): Promise<{ error: Error | null; removed: number }> {
  const { data, error } = await admin.storage.from(BUCKET_CONSULTORA_LOGOS).remove([path]);
  return {
    error: error ? new Error(error.message) : null,
    removed: data?.length ?? 0,
  };
}

export async function createSignedLogoUrl(
  supabase: AnyClient,
  path: string,
  ttlSec: number = SIGNED_URL_TTL_PDF_RENDER_SEC,
): Promise<{ signedUrl: string | null; error: Error | null }> {
  const { data, error } = await supabase.storage
    .from(BUCKET_CONSULTORA_LOGOS)
    .createSignedUrl(path, ttlSec);
  if (error || !data) {
    return {
      signedUrl: null,
      error: error ? new Error(error.message) : new Error('no_signed_url'),
    };
  }
  return { signedUrl: data.signedUrl, error: null };
}
