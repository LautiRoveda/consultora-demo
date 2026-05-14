/**
 * T-024 · Construccion y parseo de paths dentro de los buckets.
 *
 * Convenciones:
 *  - informe-attachments: <consultora_id>/<informe_id>/<uuid>.<ext>
 *  - consultora-logos:    <consultora_id>/logo-<timestamp>.<ext>
 *
 * Las storage policies (migration storage_buckets.sql) usan
 * `(storage.foldername(name))[1]` para extraer el consultora_id (primer
 * segmento) y `[2]` para el informe_id (segundo segmento, solo attachments).
 * Si cambiamos la convencion, hay que actualizar las policies.
 *
 * Sin server-only: el path es metadata puro, se usa desde server (insert
 * en tabla) y opcionalmente desde client para mostrar info de path.
 */
import { randomUUID } from 'node:crypto';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MIME_TO_EXT: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

export function extForMime(mime: string): string {
  const ext = MIME_TO_EXT[mime];
  if (!ext) {
    throw new Error(`extForMime: MIME desconocido: ${mime}`);
  }
  return ext;
}

function assertUuid(name: string, value: string): void {
  if (!UUID_REGEX.test(value)) {
    throw new Error(`${name}: valor invalido (esperado UUID): ${value}`);
  }
}

export function buildAttachmentPath(args: {
  consultoraId: string;
  informeId: string;
  mime: string;
}): string {
  assertUuid('consultoraId', args.consultoraId);
  assertUuid('informeId', args.informeId);
  const ext = extForMime(args.mime);
  return `${args.consultoraId}/${args.informeId}/${randomUUID()}.${ext}`;
}

export function buildLogoPath(args: { consultoraId: string; mime: string }): string {
  assertUuid('consultoraId', args.consultoraId);
  const ext = extForMime(args.mime);
  // Timestamp en milisegundos da unicidad sin colision realista (1 logo activo
  // por consultora, el server action borra el anterior antes de insertar).
  return `${args.consultoraId}/logo-${Date.now()}.${ext}`;
}

export type ParsedAttachmentPath = {
  consultoraId: string;
  informeId: string;
  objectId: string;
};

export function parseAttachmentPath(path: string): ParsedAttachmentPath | null {
  const segments = path.split('/');
  if (segments.length !== 3) return null;
  const consultoraId = segments[0];
  const informeId = segments[1];
  const file = segments[2];
  if (!consultoraId || !informeId || !file) return null;
  if (!UUID_REGEX.test(consultoraId)) return null;
  if (!UUID_REGEX.test(informeId)) return null;
  const dotIdx = file.lastIndexOf('.');
  const objectId = dotIdx > 0 ? file.slice(0, dotIdx) : file;
  if (!UUID_REGEX.test(objectId)) return null;
  return { consultoraId, informeId, objectId };
}

export type ParsedLogoPath = {
  consultoraId: string;
  filename: string;
};

export function parseLogoPath(path: string): ParsedLogoPath | null {
  const segments = path.split('/');
  if (segments.length !== 2) return null;
  const consultoraId = segments[0];
  const filename = segments[1];
  if (!consultoraId || !filename) return null;
  if (!UUID_REGEX.test(consultoraId)) return null;
  if (!filename.startsWith('logo-')) return null;
  return { consultoraId, filename };
}
