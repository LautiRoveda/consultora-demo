/**
 * T-024 · Tests unit puros de validators de attachments.
 *
 * Cubre MIME whitelist, size caps, filename sanitization, magic bytes match.
 * Sin I/O — todas funciones puras de validators.ts.
 */
import { describe, expect, it } from 'vitest';

import {
  isAttachmentMime,
  isFileMime,
  isImageMime,
  kindForMime,
  magicBytesMatch,
  sanitizeFilename,
  validateAttachmentMime,
  validateAttachmentSize,
  validateFilename,
  validateLogoMime,
  validateLogoSize,
  validateMagicBytes,
} from '@/shared/storage/validators';

describe('MIME whitelist', () => {
  it('isImageMime acepta PNG/JPG/WEBP', () => {
    expect(isImageMime('image/png')).toBe(true);
    expect(isImageMime('image/jpeg')).toBe(true);
    expect(isImageMime('image/webp')).toBe(true);
  });

  it('isImageMime rechaza SVG y HEIC (no whitelisted)', () => {
    expect(isImageMime('image/svg+xml')).toBe(false);
    expect(isImageMime('image/heic')).toBe(false);
    expect(isImageMime('image/heif')).toBe(false);
  });

  it('isFileMime acepta PDF, DOC, DOCX, XLS, XLSX', () => {
    expect(isFileMime('application/pdf')).toBe(true);
    expect(isFileMime('application/msword')).toBe(true);
    expect(
      isFileMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe(true);
    expect(isFileMime('application/vnd.ms-excel')).toBe(true);
    expect(isFileMime('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(
      true,
    );
  });

  it('isFileMime rechaza tipos no whitelisted', () => {
    expect(isFileMime('text/html')).toBe(false);
    expect(isFileMime('application/zip')).toBe(false);
    expect(isFileMime('application/x-executable')).toBe(false);
  });

  it('kindForMime devuelve image|file|null segun el tipo', () => {
    expect(kindForMime('image/png')).toBe('image');
    expect(kindForMime('application/pdf')).toBe('file');
    expect(kindForMime('text/html')).toBe(null);
  });

  it('isAttachmentMime es la union de image + file', () => {
    expect(isAttachmentMime('image/png')).toBe(true);
    expect(isAttachmentMime('application/pdf')).toBe(true);
    expect(isAttachmentMime('text/html')).toBe(false);
  });

  it('validateAttachmentMime retorna null para MIME valido', () => {
    expect(validateAttachmentMime('image/png')).toBeNull();
    expect(validateAttachmentMime('application/pdf')).toBeNull();
  });

  it('validateAttachmentMime retorna UNSUPPORTED_MIME para invalido', () => {
    const err = validateAttachmentMime('image/heic');
    expect(err?.code).toBe('UNSUPPORTED_MIME');
    expect(err?.message).toContain('image/heic');
  });

  it('validateLogoMime acepta solo images', () => {
    expect(validateLogoMime('image/png')).toBeNull();
    expect(validateLogoMime('application/pdf')?.code).toBe('UNSUPPORTED_MIME');
  });
});

describe('Size validators', () => {
  it('validateAttachmentSize: 0 bytes → PAYLOAD_TOO_LARGE', () => {
    expect(validateAttachmentSize(0)?.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('validateAttachmentSize: 1 byte → OK', () => {
    expect(validateAttachmentSize(1)).toBeNull();
  });

  it('validateAttachmentSize: 10 MB exacto → OK', () => {
    expect(validateAttachmentSize(10 * 1024 * 1024)).toBeNull();
  });

  it('validateAttachmentSize: 10 MB + 1 → PAYLOAD_TOO_LARGE', () => {
    expect(validateAttachmentSize(10 * 1024 * 1024 + 1)?.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('validateLogoSize: 2 MB exacto → OK', () => {
    expect(validateLogoSize(2 * 1024 * 1024)).toBeNull();
  });

  it('validateLogoSize: 2 MB + 1 → PAYLOAD_TOO_LARGE', () => {
    expect(validateLogoSize(2 * 1024 * 1024 + 1)?.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('Filename sanitization', () => {
  it('preserva nombre normal', () => {
    expect(sanitizeFilename('relevamiento.pdf')).toBe('relevamiento.pdf');
  });

  it('preserva acentos (NFKD normalize estabiliza)', () => {
    const out = sanitizeFilename('relevamiento año 2026.pdf');
    expect(out).toMatch(/relevamiento.*2026\.pdf/);
  });

  it('strip path separators', () => {
    expect(sanitizeFilename('../etc/passwd')).not.toContain('/');
    expect(sanitizeFilename('..\\windows\\system.dll')).not.toContain('\\');
  });

  it('strip caracteres de control', () => {
    const ctrl = 'file' + String.fromCharCode(0x00) + String.fromCharCode(0x1a) + '.pdf';
    const out = sanitizeFilename(ctrl);
    expect(out).not.toMatch(/[\x00-\x1f]/);
    expect(out).toContain('.pdf');
  });

  it('collapse whitespace', () => {
    expect(sanitizeFilename('hola    mundo.pdf')).toBe('hola mundo.pdf');
  });

  it('input vacio → "archivo" default', () => {
    expect(sanitizeFilename('')).toBe('archivo');
    expect(sanitizeFilename('   ')).toBe('archivo');
  });

  it('input > 255 chars: trunca preservando extension corta', () => {
    const base = 'a'.repeat(300);
    const out = sanitizeFilename(base + '.pdf');
    expect(out.length).toBe(255);
    expect(out.endsWith('.pdf')).toBe(true);
  });

  it('input > 255 chars sin extension: trunca a 255', () => {
    const out = sanitizeFilename('a'.repeat(300));
    expect(out.length).toBe(255);
  });

  it('validateFilename retorna null para nombre razonable', () => {
    expect(validateFilename('foto.png')).toBeNull();
  });

  it('validateFilename rechaza vacio', () => {
    expect(validateFilename('')?.code).toBe('INVALID_FILENAME');
    expect(validateFilename('   ')?.code).toBe('INVALID_FILENAME');
  });

  it('validateFilename rechaza > 255 chars', () => {
    expect(validateFilename('a'.repeat(256))?.code).toBe('INVALID_FILENAME');
  });
});

describe('Magic bytes', () => {
  it('PNG: header 89 50 4E 47 0D 0A 1A 0A → match', () => {
    const b = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xff]);
    expect(magicBytesMatch(b, 'image/png')).toBe(true);
  });

  it('PNG: header alterado → no match', () => {
    const b = new Uint8Array([0x89, 0x50, 0x4e, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(magicBytesMatch(b, 'image/png')).toBe(false);
  });

  it('JPEG: header FF D8 FF → match', () => {
    const b = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(magicBytesMatch(b, 'image/jpeg')).toBe(true);
  });

  it('WEBP: RIFF....WEBP → match', () => {
    const b = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(magicBytesMatch(b, 'image/webp')).toBe(true);
  });

  it('PDF: header %PDF → match', () => {
    const b = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e]);
    expect(magicBytesMatch(b, 'application/pdf')).toBe(true);
  });

  it('PDF: archivo no-PDF (HTML) → no match', () => {
    const b = new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]); // <html>
    expect(magicBytesMatch(b, 'application/pdf')).toBe(false);
  });

  it('DOC legacy: D0 CF 11 E0 A1 B1 1A E1 → match', () => {
    const b = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]);
    expect(magicBytesMatch(b, 'application/msword')).toBe(true);
    expect(magicBytesMatch(b, 'application/vnd.ms-excel')).toBe(true);
  });

  it('DOCX/XLSX: ZIP header 50 4B 03 04 → match', () => {
    const b = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    expect(
      magicBytesMatch(b, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe(true);
    expect(
      magicBytesMatch(b, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ).toBe(true);
  });

  it('MIME desconocido → falla cerrado', () => {
    const b = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
    expect(magicBytesMatch(b, 'text/html')).toBe(false);
  });

  it('buffer < 4 bytes → no match', () => {
    expect(magicBytesMatch(new Uint8Array([0x89, 0x50, 0x4e]), 'image/png')).toBe(false);
  });

  it('validateMagicBytes wrappea: PDF spoofed como PNG → MAGIC_BYTES_MISMATCH', () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e]);
    expect(validateMagicBytes(pdf, 'image/png')?.code).toBe('MAGIC_BYTES_MISMATCH');
  });

  it('validateMagicBytes wrappea: PNG genuino → null', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(validateMagicBytes(png, 'image/png')).toBeNull();
  });
});
