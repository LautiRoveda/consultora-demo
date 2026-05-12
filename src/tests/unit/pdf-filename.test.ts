/**
 * T-023 · Tests de slugifyTitulo + buildPdfFilename.
 *
 * Cubre los edge cases del naming del PDF descargado por el consultor:
 *  - Acentos (NFKD + drop combining marks).
 *  - Espacios y simbolos colapsados a guion.
 *  - Max length 80 con cut en boundary de palabra.
 *  - Vacio / solo whitespace → fallback "informe".
 *  - Format completo: informe-<tipo>-<slug>-YYYY-MM-DD.pdf.
 */
import { describe, expect, it } from 'vitest';

import { buildPdfFilename, labelForTipo, slugifyTitulo } from '@/shared/pdf/filename';

describe('slugifyTitulo', () => {
  it('caso basico: lower + dashes', () => {
    expect(slugifyTitulo('Informe RGRL Acme S.A.')).toBe('informe-rgrl-acme-s-a');
  });

  it('drop diacriticos: acentos y ñ', () => {
    expect(slugifyTitulo('Relevamiento Córdoba')).toBe('relevamiento-cordoba');
    expect(slugifyTitulo('Compañía Niño Pequeño')).toBe('compania-nino-pequeno');
  });

  it('colapsa runs de simbolos y trim de bordes', () => {
    expect(slugifyTitulo('---Hola!!! Mundo___')).toBe('hola-mundo');
    expect(slugifyTitulo('  espacios  multiples  ')).toBe('espacios-multiples');
  });

  it('vacio / solo whitespace / solo simbolos → "informe"', () => {
    expect(slugifyTitulo('')).toBe('informe');
    expect(slugifyTitulo('   ')).toBe('informe');
    expect(slugifyTitulo('!!!---@@@')).toBe('informe');
  });

  it('max length 80 con cut en boundary de palabra (ultimo dash)', () => {
    // 100 chars con muchas palabras → trunca al ultimo '-' antes del 80.
    const long =
      'alfa beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho';
    const out = slugifyTitulo(long);
    expect(out.length).toBeLessThanOrEqual(80);
    // No corta a la mitad de "omicron" o "lambda".
    expect(out.endsWith('-')).toBe(false);
    expect(out).toMatch(/^alfa-beta/);
  });

  it('palabra unica muy larga > 80: trunca hard sin error', () => {
    const monster = 'a'.repeat(150);
    const out = slugifyTitulo(monster);
    expect(out.length).toBe(80);
    expect(out).toMatch(/^a+$/);
  });

  it('idempotente: slugify(slugify(x)) === slugify(x)', () => {
    const x = 'Informe RGRL — Metalúrgica del Sur S.A.';
    expect(slugifyTitulo(slugifyTitulo(x))).toBe(slugifyTitulo(x));
  });
});

describe('buildPdfFilename', () => {
  it('format completo con createdAt string ISO', () => {
    const out = buildPdfFilename({
      tipo: 'rgrl',
      titulo: 'Metalúrgica del Sur SA',
      createdAt: '2026-05-12T14:30:00.000Z',
    });
    expect(out).toBe('informe-rgrl-metalurgica-del-sur-sa-2026-05-12.pdf');
  });

  it('format completo con createdAt Date', () => {
    const date = new Date(Date.UTC(2026, 0, 7, 9, 0, 0));
    const out = buildPdfFilename({ tipo: 'accidente', titulo: 'Test', createdAt: date });
    expect(out).toBe('informe-accidente-test-2026-01-07.pdf');
  });

  it('padding zeros en mes/dia', () => {
    const date = new Date(Date.UTC(2026, 2, 5));
    const out = buildPdfFilename({ tipo: 'otros', titulo: 'Marzo', createdAt: date });
    expect(out).toContain('2026-03-05.pdf');
  });

  it('titulo vacio → "informe" en el slug', () => {
    const out = buildPdfFilename({
      tipo: 'capacitacion',
      titulo: '',
      createdAt: '2026-05-12T00:00:00.000Z',
    });
    expect(out).toBe('informe-capacitacion-informe-2026-05-12.pdf');
  });
});

describe('labelForTipo', () => {
  it('devuelve labels es-AR para los 5 tipos', () => {
    expect(labelForTipo('rgrl')).toBe('RGRL');
    expect(labelForTipo('capacitacion')).toBe('Capacitación');
    expect(labelForTipo('accidente')).toBe('Accidente');
    expect(labelForTipo('relevamiento')).toBe('Relevamiento');
    expect(labelForTipo('otros')).toBe('Otros');
  });
});
