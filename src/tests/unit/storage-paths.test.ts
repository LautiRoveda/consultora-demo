/**
 * T-024 · Tests unit de paths del storage.
 */
import { describe, expect, it } from 'vitest';

import {
  buildAttachmentPath,
  buildLogoPath,
  extForMime,
  parseAttachmentPath,
  parseLogoPath,
} from '@/shared/storage/paths';

const VALID_UUID_A = '12345678-1234-1234-1234-123456789abc';
const VALID_UUID_B = '87654321-4321-4321-4321-cba987654321';

describe('extForMime', () => {
  it('mapea cada MIME whitelisted a su extension', () => {
    expect(extForMime('image/png')).toBe('png');
    expect(extForMime('image/jpeg')).toBe('jpg');
    expect(extForMime('image/webp')).toBe('webp');
    expect(extForMime('application/pdf')).toBe('pdf');
    expect(extForMime('application/msword')).toBe('doc');
    expect(
      extForMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe('docx');
    expect(extForMime('application/vnd.ms-excel')).toBe('xls');
    expect(extForMime('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(
      'xlsx',
    );
  });

  it('throws para MIME desconocido', () => {
    expect(() => extForMime('text/html')).toThrow(/desconocido/);
  });
});

describe('buildAttachmentPath', () => {
  it('produce path con shape <consultora>/<informe>/<uuid>.<ext>', () => {
    const path = buildAttachmentPath({
      consultoraId: VALID_UUID_A,
      informeId: VALID_UUID_B,
      mime: 'image/png',
    });
    expect(path).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/);
    expect(path.startsWith(`${VALID_UUID_A}/${VALID_UUID_B}/`)).toBe(true);
  });

  it('cada invocacion genera UUID nuevo (anti-colision)', () => {
    const a = buildAttachmentPath({
      consultoraId: VALID_UUID_A,
      informeId: VALID_UUID_B,
      mime: 'image/png',
    });
    const b = buildAttachmentPath({
      consultoraId: VALID_UUID_A,
      informeId: VALID_UUID_B,
      mime: 'image/png',
    });
    expect(a).not.toBe(b);
  });

  it('throws si consultoraId no es UUID', () => {
    expect(() =>
      buildAttachmentPath({
        consultoraId: 'not-a-uuid',
        informeId: VALID_UUID_B,
        mime: 'image/png',
      }),
    ).toThrow(/consultoraId/);
  });

  it('throws si informeId no es UUID', () => {
    expect(() =>
      buildAttachmentPath({
        consultoraId: VALID_UUID_A,
        informeId: 'evil',
        mime: 'image/png',
      }),
    ).toThrow(/informeId/);
  });
});

describe('buildLogoPath', () => {
  it('produce path con shape <consultora>/logo-<ts>.<ext>', () => {
    const path = buildLogoPath({ consultoraId: VALID_UUID_A, mime: 'image/png' });
    expect(path).toMatch(/^[0-9a-f-]{36}\/logo-\d+\.png$/);
  });

  it('cada invocacion genera path distinto (timestamp ms)', async () => {
    const a = buildLogoPath({ consultoraId: VALID_UUID_A, mime: 'image/png' });
    await new Promise((r) => setTimeout(r, 5));
    const b = buildLogoPath({ consultoraId: VALID_UUID_A, mime: 'image/png' });
    expect(a).not.toBe(b);
  });
});

describe('parseAttachmentPath', () => {
  it('parsea path valido', () => {
    const path = `${VALID_UUID_A}/${VALID_UUID_B}/abcdef12-3456-7890-abcd-ef1234567890.png`;
    const parsed = parseAttachmentPath(path);
    expect(parsed).toEqual({
      consultoraId: VALID_UUID_A,
      informeId: VALID_UUID_B,
      objectId: 'abcdef12-3456-7890-abcd-ef1234567890',
    });
  });

  it('rechaza path con cantidad de segmentos invalida', () => {
    expect(parseAttachmentPath(`${VALID_UUID_A}/file.png`)).toBeNull();
    expect(parseAttachmentPath(`a/b/c/d.png`)).toBeNull();
  });

  it('rechaza UUIDs invalidos', () => {
    expect(
      parseAttachmentPath(`x/${VALID_UUID_B}/abcdef12-3456-7890-abcd-ef1234567890.png`),
    ).toBeNull();
    expect(
      parseAttachmentPath(`${VALID_UUID_A}/y/abcdef12-3456-7890-abcd-ef1234567890.png`),
    ).toBeNull();
  });

  it('round-trip: build + parse devuelve los mismos IDs', () => {
    const path = buildAttachmentPath({
      consultoraId: VALID_UUID_A,
      informeId: VALID_UUID_B,
      mime: 'image/jpeg',
    });
    const parsed = parseAttachmentPath(path);
    expect(parsed?.consultoraId).toBe(VALID_UUID_A);
    expect(parsed?.informeId).toBe(VALID_UUID_B);
    expect(parsed?.objectId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('parseLogoPath', () => {
  it('parsea path valido', () => {
    const parsed = parseLogoPath(`${VALID_UUID_A}/logo-1700000000000.png`);
    expect(parsed?.consultoraId).toBe(VALID_UUID_A);
    expect(parsed?.filename).toBe('logo-1700000000000.png');
  });

  it('rechaza path sin prefijo logo-', () => {
    expect(parseLogoPath(`${VALID_UUID_A}/banner.png`)).toBeNull();
  });

  it('rechaza UUID invalido', () => {
    expect(parseLogoPath(`xyz/logo-1.png`)).toBeNull();
  });
});
