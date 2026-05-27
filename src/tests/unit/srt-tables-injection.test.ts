/**
 * T-107 · Tests del helper injectSRTTables + formatVerifiedAt.
 *
 * Tests puros sobre constantes TS — no DB, no SDK Anthropic, no mocks
 * pesados. Convención repo: `src/tests/unit/` para tests sin DB
 * (precedente directo: `epp-suggest-prompt.test.ts`).
 */
import { describe, expect, it } from 'vitest';

import { formatVerifiedAt, injectSRTTables } from '@/shared/ai/srt-tables';

describe('injectSRTTables', () => {
  it('returns Res 85/12 block when agentes=[ruido]', () => {
    const result = injectSRTTables(['ruido']);
    expect(result).toContain('Resolución SRT 85/2012');
    expect(result).toContain('TLV ruido continuo o intermitente:** 85 dB(A)');
    expect(result).toContain('Decreto 351/79 Anexo V');
    // Iluminación queda como FU0; el bloque NO debe contener Res 84/12.
    expect(result).not.toContain('Resolución SRT 84/2012');
  });

  it('returns empty string for agente without table loaded (ergonomia)', () => {
    expect(injectSRTTables(['ergonomia'])).toBe('');
  });

  it('returns empty string when agentes is empty array', () => {
    expect(injectSRTTables([])).toBe('');
  });

  it('returns only loaded tables when mixed agentes', () => {
    const result = injectSRTTables(['ruido', 'ergonomia', 'iluminacion']);
    // ruido sí — única tabla cargada en MVP
    expect(result).toContain('Resolución SRT 85/2012');
    // iluminación + ergonomía: sin tabla cargada → no aparecen
    expect(result).not.toContain('Resolución SRT 84/2012');
  });

  it('replaces {VERIFIED_AT} placeholder with date parsed from version_tabla', () => {
    const result = injectSRTTables(['ruido']);
    // El const RES_85_12_RUIDO tiene version_tabla='2026-05-27-v1'.
    expect(result).toContain('Vigencia verificada al 2026-05-27');
    expect(result).not.toContain('{VERIFIED_AT}');
  });
});

describe('formatVerifiedAt', () => {
  it('extracts YYYY-MM-DD from valid YYYY-MM-DD-vN format', () => {
    expect(formatVerifiedAt('2026-05-27-v1')).toBe('2026-05-27');
    expect(formatVerifiedAt('2024-01-15-v3')).toBe('2024-01-15');
  });

  it('throws when version_tabla has invalid format', () => {
    expect(() => formatVerifiedAt('invalid')).toThrow(/Invalid version_tabla format/);
    expect(() => formatVerifiedAt('')).toThrow(/Invalid version_tabla format/);
    expect(() => formatVerifiedAt('2026-5-27-v1')).toThrow(/Invalid version_tabla format/);
    expect(() => formatVerifiedAt('v1-2026-05-27')).toThrow(/Invalid version_tabla format/);
  });
});
