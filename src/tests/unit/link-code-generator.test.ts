/**
 * T-033 · Tests del generador de link_code para Telegram.
 *
 * Cobertura:
 *  - Longitud exacta = 8 chars.
 *  - Solo caracteres del alfabeto permitido (sin 0/O/1/I/lowercase).
 *  - 1000 ejecuciones consecutivas sin duplicados (smoke estadístico —
 *    P(collision) en 1000 muestras de 32^8 ≈ 10^11 espacio ≈ 5×10^-6).
 *  - Distribución cualitativamente uniforme (cada char del alfabeto
 *    aparece > 0 veces en 10k ejecuciones).
 */
import { describe, expect, it, vi } from 'vitest';

import {
  generateLinkCode,
  LINK_CODE_ALPHABET,
  LINK_CODE_LENGTH,
} from '@/shared/telegram/link-code';

// link-code.ts importa 'server-only'. En Node (Vitest unit) el paquete
// tira si lo importan; el mock lo neutraliza. Vitest hoist vi.mock al tope.
vi.mock('server-only', () => ({}));

describe('generateLinkCode', () => {
  it('longitud exacta = LINK_CODE_LENGTH (8)', () => {
    expect(LINK_CODE_LENGTH).toBe(8);
    const code = generateLinkCode();
    expect(code.length).toBe(8);
  });

  it('todos los chars pertenecen al alfabeto', () => {
    const allowed = new Set(LINK_CODE_ALPHABET);
    for (let i = 0; i < 100; i += 1) {
      const code = generateLinkCode();
      for (const char of code) {
        expect(allowed.has(char)).toBe(true);
      }
    }
  });

  it('alfabeto no incluye chars ambiguos: 0, O, 1, I, lowercase', () => {
    expect(LINK_CODE_ALPHABET).not.toContain('0');
    expect(LINK_CODE_ALPHABET).not.toContain('O');
    expect(LINK_CODE_ALPHABET).not.toContain('1');
    expect(LINK_CODE_ALPHABET).not.toContain('I');
    expect(LINK_CODE_ALPHABET).toBe(LINK_CODE_ALPHABET.toUpperCase());
  });

  it('alfabeto tiene exactamente 32 chars (= 5 bits, mod uniforme con bytes)', () => {
    expect(LINK_CODE_ALPHABET.length).toBe(32);
  });

  it('1000 generaciones consecutivas → 0 duplicados (smoke estadístico)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      const code = generateLinkCode();
      expect(seen.has(code)).toBe(false);
      seen.add(code);
    }
    expect(seen.size).toBe(1000);
  });

  it('10k ejecuciones cubren todos los chars del alfabeto (distribución cualitativa)', () => {
    const charCounts = new Map<string, number>();
    for (let i = 0; i < 10_000; i += 1) {
      const code = generateLinkCode();
      for (const char of code) {
        charCounts.set(char, (charCounts.get(char) ?? 0) + 1);
      }
    }
    // 10_000 codes × 8 chars / 32 alfabeto = ~2500 per char esperado.
    // Verificamos que TODOS los 32 chars aparecieron > 0 veces.
    for (const char of LINK_CODE_ALPHABET) {
      expect(charCounts.get(char)).toBeGreaterThan(0);
    }
  });
});
