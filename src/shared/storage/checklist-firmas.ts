import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

import { BUCKET_CHECKLIST_FIRMAS, SIGNED_URL_TTL_UI_SEC } from './types';

/**
 * T-060a · Helpers de Storage para el bucket `checklist-firmas` (clon de
 * epp-firmas.ts, T-102). Writes via SERVICE-ROLE (gated por cerrarEjecucionAction
 * owner-only); reads via signed URL (la storage policy SELECT exige member del
 * tenant, foldername[1]=consultora_id).
 *
 * Path: `<consultora_id>/<execution_id>.png`. A diferencia de epp-firmas (UUID
 * por entrega → upsert:false), acá el path es POR EJECUCIÓN (fijo). El cierre es
 * idempotente/reintentable, así que el upload usa `upsert: true`: un reintento
 * tras un cierre que falló a mitad sobreescribe limpio (la fila aún es borrador,
 * la firma no es legalmente definitiva hasta el flip a `cerrada`).
 *
 * Reuso de `decodeFirmaDataUrl`: vive en epp-firmas.ts y es genérico
 * (`data:image/png;base64,`) — lo importa el action directamente desde allí.
 */

type AnyClient = SupabaseClient<Database>;

export function buildChecklistFirmaPath(consultoraId: string, executionId: string): string {
  return `${consultoraId}/${executionId}.png`;
}

export async function uploadChecklistFirma(
  admin: AnyClient,
  args: { path: string; bytes: Buffer | Uint8Array },
): Promise<{ error: Error | null }> {
  const { error } = await admin.storage
    .from(BUCKET_CHECKLIST_FIRMAS)
    .upload(args.path, args.bytes, {
      contentType: 'image/png',
      cacheControl: '3600',
      upsert: true,
    });
  return { error: error ? new Error(error.message) : null };
}

export async function deleteChecklistFirma(
  admin: AnyClient,
  path: string,
): Promise<{ error: Error | null; removed: number }> {
  const { data, error } = await admin.storage.from(BUCKET_CHECKLIST_FIRMAS).remove([path]);
  return { error: error ? new Error(error.message) : null, removed: data?.length ?? 0 };
}

export async function createSignedChecklistFirmaUrl(
  supabase: AnyClient,
  path: string,
  ttlSec: number = SIGNED_URL_TTL_UI_SEC,
): Promise<{ signedUrl: string | null; error: Error | null }> {
  const { data, error } = await supabase.storage
    .from(BUCKET_CHECKLIST_FIRMAS)
    .createSignedUrl(path, ttlSec);
  if (error || !data) {
    return {
      signedUrl: null,
      error: error ? new Error(error.message) : new Error('no_signed_url'),
    };
  }
  return { signedUrl: data.signedUrl, error: null };
}
