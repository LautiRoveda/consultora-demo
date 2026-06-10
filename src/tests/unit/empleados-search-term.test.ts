import { describe, expect, it } from 'vitest';

import { sanitizeNombreSearchTerm } from '@/app/(app)/empleados/search-term';

/**
 * T-134 · El término se interpola en el `.or()` CRUDO de PostgREST, donde
 * `,` `(` `)` `"` son sintaxis estructural y `*` es alias de `%` en ilike.
 * Estos tests cubren las dos caras: (1) ningún char estructural sobrevive al
 * saneo, (2) los nombres reales (acentos / guion / apóstrofo / punto) pasan
 * intactos — sin sobre-bloqueo.
 */
describe('sanitizeNombreSearchTerm · estructurales PostgREST', () => {
  it('neutraliza el término inyectado clásico: la coma no separa condiciones', () => {
    const r = sanitizeNombreSearchTerm('a,nombre.ilike.%');
    expect(r).toBe('anombre.ilike.');
    expect(r).not.toContain(',');
    expect(r).not.toContain('%');
  });

  it('elimina paréntesis, comillas dobles y dos puntos', () => {
    expect(sanitizeNombreSearchTerm('Pérez (h)')).toBe('Pérez h');
    expect(sanitizeNombreSearchTerm('"García"')).toBe('García');
    expect(sanitizeNombreSearchTerm('a:b')).toBe('ab');
  });

  it('elimina * (alias de % en like/ilike de PostgREST, que el escape viejo no cubría)', () => {
    expect(sanitizeNombreSearchTerm('Juan*')).toBe('Juan');
  });

  it('elimina wildcards LIKE % _ \\ (antes escapados, ahora fuera del charset)', () => {
    expect(sanitizeNombreSearchTerm('%%')).toBe('');
    expect(sanitizeNombreSearchTerm('Juan_Pablo')).toBe('JuanPablo');
    expect(sanitizeNombreSearchTerm('a\\b cd')).toBe('ab cd');
  });

  it('término solo-estructural queda vacío (cae al guard < 2 chars del caller)', () => {
    expect(sanitizeNombreSearchTerm(',,((""')).toBe('');
  });
});

describe('sanitizeNombreSearchTerm · no-sobre-bloqueo de nombres reales', () => {
  it('conserva apóstrofo, guion, acentos, eñes, punto y dígitos', () => {
    expect(sanitizeNombreSearchTerm("O'Brien")).toBe("O'Brien");
    expect(sanitizeNombreSearchTerm('García-López')).toBe('García-López');
    expect(sanitizeNombreSearchTerm('Ñúñez')).toBe('Ñúñez');
    expect(sanitizeNombreSearchTerm('D’Alessandro')).toBe('D’Alessandro');
    expect(sanitizeNombreSearchTerm('Ma. José')).toBe('Ma. José');
    expect(sanitizeNombreSearchTerm('Sáenz Peña 3')).toBe('Sáenz Peña 3');
  });

  it('conserva acentos en NFD (letra + marca combinante, \\p{M})', () => {
    // "Pérez" descompuesto. El combinante va por escape, NO literal — los
    // combinantes literales se corrompen al pegar/editar y son invisibles en
    // el diff (misma razón que el \p{Diacritic} de normalizeForSearch).
    const nfd = 'Pe\u0301rez';
    expect(sanitizeNombreSearchTerm(nfd)).toBe(nfd);
  });

  it('recorta los bordes huérfanos que deja el strip', () => {
    expect(sanitizeNombreSearchTerm(', Mendoza')).toBe('Mendoza');
  });

  it('mantiene el cap de 100 chars', () => {
    expect(sanitizeNombreSearchTerm('a'.repeat(150))).toHaveLength(100);
  });
});
