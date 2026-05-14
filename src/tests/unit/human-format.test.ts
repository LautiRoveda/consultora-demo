/**
 * T-024 · Tests unit de helpers de formato human-readable.
 */
import { describe, expect, it } from 'vitest';

import { humanBytes, humanMime } from '@/shared/storage/format';

describe('humanBytes', () => {
  it('0 → "0 B"', () => {
    expect(humanBytes(0)).toBe('0 B');
  });

  it('< 1 KB → bytes', () => {
    expect(humanBytes(500)).toBe('500 B');
    expect(humanBytes(1023)).toBe('1023 B');
  });

  it('1 KB → "1.0 KB"', () => {
    expect(humanBytes(1024)).toBe('1.0 KB');
  });

  it('100 KB → entero', () => {
    expect(humanBytes(100 * 1024)).toBe('100 KB');
  });

  it('1.5 MB → "1.5 MB"', () => {
    expect(humanBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });

  it('10 MB → "10.0 MB"', () => {
    expect(humanBytes(10 * 1024 * 1024)).toBe('10.0 MB');
  });

  it('1 GB → "1.0 GB"', () => {
    expect(humanBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
  });

  it('negativo o NaN → "—"', () => {
    expect(humanBytes(-1)).toBe('—');
    expect(humanBytes(NaN)).toBe('—');
    expect(humanBytes(Infinity)).toBe('—');
  });
});

describe('humanMime', () => {
  it('mapea MIMEs conocidos a labels', () => {
    expect(humanMime('image/png')).toBe('PNG');
    expect(humanMime('image/jpeg')).toBe('JPG');
    expect(humanMime('image/webp')).toBe('WEBP');
    expect(humanMime('application/pdf')).toBe('PDF');
    expect(humanMime('application/msword')).toBe('DOC');
    expect(
      humanMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe('DOCX');
    expect(humanMime('application/vnd.ms-excel')).toBe('XLS');
    expect(humanMime('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(
      'XLSX',
    );
  });

  it('passthrough para MIMEs desconocidos', () => {
    expect(humanMime('image/svg+xml')).toBe('image/svg+xml');
    expect(humanMime('text/html')).toBe('text/html');
  });
});
