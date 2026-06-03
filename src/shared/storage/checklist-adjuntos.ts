import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ImageMimeType } from './types';

import { BUCKET_CHECKLIST_ADJUNTOS, SIGNED_URL_TTL_UI_SEC } from './types';

/**
 * T-060a · Helpers de Storage para el bucket `checklist-adjuntos` (fotos de
 * evidencia). Mismo patrón que epp-firmas: write via SERVICE-ROLE (gated por la
 * action, upload-first + rollback), read via signed URL (storage policy SELECT
 * exige member del tenant, foldername[1]=consultora_id).
 *
 * Path: `<consultora_id>/<execution_id>/<adjunto_id>.<ext>`. Acepta PNG/JPG/WEBP
 * (el bucket valida allowed_mime_types; el action valida magic-bytes anti-spoof).
 */

type AnyClient = SupabaseClient<Database>;

const EXT_BY_MIME: Record<ImageMimeType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export function extForImageMime(mime: ImageMimeType): string {
  return EXT_BY_MIME[mime];
}

export function buildChecklistAdjuntoPath(
  consultoraId: string,
  executionId: string,
  adjuntoId: string,
  ext: string,
): string {
  return `${consultoraId}/${executionId}/${adjuntoId}.${ext}`;
}

/**
 * Decodifica una data URL `data:image/(png|jpeg|webp);base64,...` a bytes + mime.
 * Lanza si el prefix no matchea o el payload está vacío. El caller valida
 * magic-bytes (defensa anti-MIME-spoof) y tamaño después.
 */
export function decodeImageDataUrl(dataUrl: string): { mime: ImageMimeType; bytes: Uint8Array } {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]*)$/.exec(dataUrl);
  if (!match) throw new Error('adjunto_invalid_prefix');
  const mime = match[1] as ImageMimeType;
  const base64 = match[2] ?? '';
  if (base64.length === 0) throw new Error('adjunto_empty_payload');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { mime, bytes };
}

export async function uploadChecklistAdjunto(
  admin: AnyClient,
  args: { path: string; bytes: Buffer | Uint8Array; contentType: ImageMimeType },
): Promise<{ error: Error | null }> {
  const { error } = await admin.storage
    .from(BUCKET_CHECKLIST_ADJUNTOS)
    .upload(args.path, args.bytes, {
      contentType: args.contentType,
      cacheControl: '3600',
      upsert: false,
    });
  return { error: error ? new Error(error.message) : null };
}

export async function deleteChecklistAdjunto(
  admin: AnyClient,
  path: string,
): Promise<{ error: Error | null; removed: number }> {
  const { data, error } = await admin.storage.from(BUCKET_CHECKLIST_ADJUNTOS).remove([path]);
  return { error: error ? new Error(error.message) : null, removed: data?.length ?? 0 };
}

export async function createSignedChecklistAdjuntoUrl(
  supabase: AnyClient,
  path: string,
  ttlSec: number = SIGNED_URL_TTL_UI_SEC,
): Promise<{ signedUrl: string | null; error: Error | null }> {
  const { data, error } = await supabase.storage
    .from(BUCKET_CHECKLIST_ADJUNTOS)
    .createSignedUrl(path, ttlSec);
  if (error || !data) {
    return {
      signedUrl: null,
      error: error ? new Error(error.message) : new Error('no_signed_url'),
    };
  }
  return { signedUrl: data.signedUrl, error: null };
}
