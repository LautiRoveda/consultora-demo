import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

import { BUCKET_EPP_FIRMAS, SIGNED_URL_TTL_UI_SEC } from './types';

/**
 * T-102 · Helpers de Storage para bucket epp-firmas.
 *
 * Patron clon de logo.ts: writes via SERVICE-ROLE (gated por createEntregaAction),
 * reads via USER client (gated por storage policy SELECT con is_member_of_consultora).
 *
 * Path convention: <consultora_id>/<entrega_id>.png. UUID unico por entrega
 * evita colisiones; ningun replace en disco salvo el flujo de rollback manual
 * del server action en caso de error pre-commit.
 *
 * Re-uso T-104 (Planilla Res 299/11 PDF): el render del PDF llama a
 * createSignedEppFirmaUrl + Puppeteer setContent con la firma embed.
 */

type AnyClient = SupabaseClient<Database>;

export function buildEppFirmaPath(consultoraId: string, entregaId: string): string {
  return `${consultoraId}/${entregaId}.png`;
}

export async function uploadEppFirma(
  admin: AnyClient,
  args: {
    path: string;
    bytes: Buffer | Uint8Array;
  },
): Promise<{ error: Error | null }> {
  const { error } = await admin.storage.from(BUCKET_EPP_FIRMAS).upload(args.path, args.bytes, {
    contentType: 'image/png',
    cacheControl: '3600',
    upsert: false,
  });
  return { error: error ? new Error(error.message) : null };
}

export async function deleteEppFirma(
  admin: AnyClient,
  path: string,
): Promise<{ error: Error | null; removed: number }> {
  const { data, error } = await admin.storage.from(BUCKET_EPP_FIRMAS).remove([path]);
  return {
    error: error ? new Error(error.message) : null,
    removed: data?.length ?? 0,
  };
}

export async function createSignedEppFirmaUrl(
  supabase: AnyClient,
  path: string,
  ttlSec: number = SIGNED_URL_TTL_UI_SEC,
): Promise<{ signedUrl: string | null; error: Error | null }> {
  const { data, error } = await supabase.storage
    .from(BUCKET_EPP_FIRMAS)
    .createSignedUrl(path, ttlSec);
  if (error || !data) {
    return {
      signedUrl: null,
      error: error ? new Error(error.message) : new Error('no_signed_url'),
    };
  }
  return { signedUrl: data.signedUrl, error: null };
}

/**
 * Decode una data URL `data:image/png;base64,...` a Uint8Array.
 * Lanza Error si el prefix no matchea o si el base64 esta corrupto.
 *
 * Vive aca y no en types.ts porque tipos.ts no es server-only y atob esta
 * disponible en ambos contextos (Node 22 + browser). Pero los unicos callers
 * son server actions (createEntregaAction); manteniendolo en este modulo
 * agrupado con el resto del flow de firma.
 */
export function decodeFirmaDataUrl(dataUrl: string): Uint8Array {
  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix)) {
    throw new Error('firma_invalid_prefix');
  }
  const base64 = dataUrl.slice(prefix.length);
  if (base64.length === 0) {
    throw new Error('firma_empty_payload');
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
