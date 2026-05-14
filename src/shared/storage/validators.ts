/**
 * T-024 · Validators puros para uploads (MIME, size, filename, magic bytes).
 *
 * Sin server-only: usados desde route handlers (server) y opcionalmente
 * para pre-check en client (UI muestra error temprano si el user elige
 * un archivo de 50 MB antes de iniciar la transferencia).
 *
 * Defensiva en profundidad:
 *  1. validateMime: el client manda Content-Type, lo whitelisteamos.
 *  2. magicBytesMatch: confirma que el archivo realmente es lo que dice ser
 *     (anti-MIME-spoof). Solo defensiva — Supabase Storage ya filtra por
 *     allowed_mime_types del bucket.
 *  3. validateSize: 10 MB attachment / 2 MB logo.
 *  4. sanitizeFilename: NFKD + strip path separators + max 255 chars.
 */
import type { AttachmentKind } from './types';

import {
  FILE_MIME_TYPES,
  IMAGE_MIME_TYPES,
  MAX_ATTACHMENT_SIZE_BYTES,
  MAX_FILENAME_LENGTH,
  MAX_LOGO_SIZE_BYTES,
  MIN_FILENAME_LENGTH,
} from './types';

export type ValidationErrorCode =
  | 'UNSUPPORTED_MIME'
  | 'PAYLOAD_TOO_LARGE'
  | 'INVALID_FILENAME'
  | 'MAGIC_BYTES_MISMATCH';

export type ValidationError = {
  code: ValidationErrorCode;
  message: string;
};

export function isImageMime(mime: string): boolean {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(mime);
}

export function isFileMime(mime: string): boolean {
  return (FILE_MIME_TYPES as readonly string[]).includes(mime);
}

export function isAttachmentMime(mime: string): boolean {
  return isImageMime(mime) || isFileMime(mime);
}

export function kindForMime(mime: string): AttachmentKind | null {
  if (isImageMime(mime)) return 'image';
  if (isFileMime(mime)) return 'file';
  return null;
}

export function validateAttachmentMime(mime: string): ValidationError | null {
  if (!isAttachmentMime(mime)) {
    return {
      code: 'UNSUPPORTED_MIME',
      message: `Tipo de archivo no permitido: ${mime}. Solo PNG/JPG/WEBP para imagenes y PDF/DOC/XLS para archivos.`,
    };
  }
  return null;
}

export function validateLogoMime(mime: string): ValidationError | null {
  if (!isImageMime(mime)) {
    return {
      code: 'UNSUPPORTED_MIME',
      message: `Tipo de logo no permitido: ${mime}. Solo PNG/JPG/WEBP.`,
    };
  }
  return null;
}

export function validateAttachmentSize(bytes: number): ValidationError | null {
  if (bytes <= 0) {
    return { code: 'PAYLOAD_TOO_LARGE', message: 'El archivo esta vacio.' };
  }
  if (bytes > MAX_ATTACHMENT_SIZE_BYTES) {
    return {
      code: 'PAYLOAD_TOO_LARGE',
      message: `El archivo excede el limite de ${Math.round(MAX_ATTACHMENT_SIZE_BYTES / 1024 / 1024)} MB.`,
    };
  }
  return null;
}

export function validateLogoSize(bytes: number): ValidationError | null {
  if (bytes <= 0) {
    return { code: 'PAYLOAD_TOO_LARGE', message: 'El archivo esta vacio.' };
  }
  if (bytes > MAX_LOGO_SIZE_BYTES) {
    return {
      code: 'PAYLOAD_TOO_LARGE',
      message: `El logo excede el limite de ${Math.round(MAX_LOGO_SIZE_BYTES / 1024 / 1024)} MB.`,
    };
  }
  return null;
}

// Regex construida via String.fromCharCode para evitar chars literales en disk
// que confunden a herramientas que tratan al archivo como binario. Patron:
// U+0000..U+001F (control) + U+007F (DEL) + backslash + forward slash.
const FILENAME_INVALID_CHARS = (() => {
  const parts: string[] = [];
  for (let i = 0; i <= 0x1f; i += 1) parts.push(String.fromCharCode(i));
  parts.push(String.fromCharCode(0x7f));
  parts.push('\\');
  parts.push('/');
  const escaped = parts
    .map((c) => {
      const code = c.charCodeAt(0);
      if (code < 0x10) return '\\x0' + code.toString(16);
      if (code < 0x20) return '\\x' + code.toString(16);
      if (c === '\\') return '\\\\';
      if (c === '/') return '\\/';
      if (c === '\x7f') return '\\x7f';
      return c;
    })
    .join('');
  return new RegExp('[' + escaped + ']', 'g');
})();

/**
 * Sanitiza el filename original del user:
 *  - NFKD normalize (estabiliza acentos).
 *  - Remueve caracteres de control (U+0000..U+001F + U+007F) y separadores
 *    de path (\, /) → previene path traversal en metadatos.
 *  - Trim + collapse whitespace.
 *  - Truncate a MAX_FILENAME_LENGTH preservando extension cuando es posible.
 *
 * NO se usa este filename como path dentro del bucket (eso lo arma
 * buildAttachmentPath con un UUID). Solo va a la columna `filename` de la
 * tabla y al header Content-Disposition al descargar.
 */
export function sanitizeFilename(input: string): string {
  let s = input.normalize('NFKD');
  s = s.replace(FILENAME_INVALID_CHARS, '_');
  s = s.trim().replace(/\s+/g, ' ');
  if (s.length === 0) return 'archivo';
  if (s.length <= MAX_FILENAME_LENGTH) return s;

  // Truncate preservando extension si existe (extension corta, ej .docx).
  const dotIdx = s.lastIndexOf('.');
  if (dotIdx > 0 && dotIdx > s.length - 12 && dotIdx < s.length - 1) {
    const ext = s.slice(dotIdx);
    const base = s.slice(0, MAX_FILENAME_LENGTH - ext.length);
    return base + ext;
  }
  return s.slice(0, MAX_FILENAME_LENGTH);
}

export function validateFilename(filename: string): ValidationError | null {
  if (typeof filename !== 'string') {
    return { code: 'INVALID_FILENAME', message: 'Nombre de archivo invalido.' };
  }
  const trimmed = filename.trim();
  if (trimmed.length < MIN_FILENAME_LENGTH) {
    return { code: 'INVALID_FILENAME', message: 'Nombre de archivo vacio.' };
  }
  if (trimmed.length > MAX_FILENAME_LENGTH) {
    return {
      code: 'INVALID_FILENAME',
      message: `Nombre de archivo demasiado largo (max ${MAX_FILENAME_LENGTH} chars).`,
    };
  }
  return null;
}

/**
 * Magic bytes check: los primeros bytes del archivo deben matchear el MIME claimed.
 * Defensa anti-MIME-spoof — un cliente malicioso podria mandar Content-Type: image/png
 * con un payload arbitrario (ej HTML con XSS).
 *
 * Implementa solo los MIME types whitelisted en types.ts.
 *
 * Acepta Uint8Array (Buffer de Node lo extiende — pasarlo funciona igual).
 * No usa Buffer global para que el archivo se importe limpio desde client si
 * en el futuro se hace pre-check con FileReader.
 */
export function magicBytesMatch(b: Uint8Array, claimedMime: string): boolean {
  if (b.length < 4) return false;

  switch (claimedMime) {
    case 'image/png':
      // 89 50 4E 47 0D 0A 1A 0A
      return (
        b.length >= 8 &&
        b[0] === 0x89 &&
        b[1] === 0x50 &&
        b[2] === 0x4e &&
        b[3] === 0x47 &&
        b[4] === 0x0d &&
        b[5] === 0x0a &&
        b[6] === 0x1a &&
        b[7] === 0x0a
      );

    case 'image/jpeg':
      // FF D8 FF
      return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

    case 'image/webp':
      // RIFF....WEBP (offset 0: RIFF; offset 8: WEBP)
      return (
        b.length >= 12 &&
        b[0] === 0x52 &&
        b[1] === 0x49 &&
        b[2] === 0x46 &&
        b[3] === 0x46 &&
        b[8] === 0x57 &&
        b[9] === 0x45 &&
        b[10] === 0x42 &&
        b[11] === 0x50
      );

    case 'application/pdf':
      // %PDF
      return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;

    case 'application/msword':
    case 'application/vnd.ms-excel':
      // DOC/XLS legacy: D0 CF 11 E0 A1 B1 1A E1 (Compound File Binary Format).
      return (
        b.length >= 8 &&
        b[0] === 0xd0 &&
        b[1] === 0xcf &&
        b[2] === 0x11 &&
        b[3] === 0xe0 &&
        b[4] === 0xa1 &&
        b[5] === 0xb1 &&
        b[6] === 0x1a &&
        b[7] === 0xe1
      );

    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      // DOCX/XLSX son ZIP containers: 50 4B 03 04 (PK con header local) o
      // variantes 50 4B 05 06 (empty archive) / 50 4B 07 08 (spanned).
      return b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07);

    default:
      // MIME desconocido: el caller ya filtro con validateAttachmentMime, esto
      // es defensa por si alguien skipea ese gate. Falla cerrado.
      return false;
  }
}

export function validateMagicBytes(bytes: Uint8Array, claimedMime: string): ValidationError | null {
  if (!magicBytesMatch(bytes, claimedMime)) {
    return {
      code: 'MAGIC_BYTES_MISMATCH',
      message: 'El contenido del archivo no coincide con su tipo declarado.',
    };
  }
  return null;
}
