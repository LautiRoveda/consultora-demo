import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { SYSTEM_PROMPT_ACCIDENTE } from '@/shared/ai/prompts/accidente';
import { SYSTEM_PROMPT_CAPACITACION } from '@/shared/ai/prompts/capacitacion';
import { SYSTEM_PROMPT_OTROS } from '@/shared/ai/prompts/otros';
import { SYSTEM_PROMPT_RELEVAMIENTO } from '@/shared/ai/prompts/relevamiento';
import { SYSTEM_PROMPT_RGRL } from '@/shared/ai/prompts/rgrl';
import { SECCIONES_CAPACITACION } from '@/shared/templates/capacitacion/secciones';
import { SECCIONES_OTROS } from '@/shared/templates/otros/secciones';
import { SECCIONES_RELEVAMIENTO } from '@/shared/templates/relevamiento/secciones';

/**
 * T-138 fase 2 · Canary de no-drift del refactor "secciones a datos".
 *
 * Los prompts de los tipos configurables (capacitacion / relevamiento / otros)
 * pasan de prosa literal a re-armarse en module-load desde el catalogo de
 * secciones (`templates/{tipo}/secciones.ts` + CUERPO_BY_SECCION). El contrato
 * del RFC: el prompt re-armado produce LAS MISMAS secciones que hoy.
 *
 * Las fixtures `fixtures/estructura-{tipo}.txt` se capturaron byte a byte de
 * los prompts PRE-refactor (scripts/dev-capture-estructura-fixtures.ts) — este
 * test corre verde como baseline antes del refactor y debe SEGUIR verde
 * despues: cualquier byte de drift (whitespace de joins, backticks escapados,
 * labels) lo rompe.
 *
 * Extension `.txt` (NO `.md`): el pre-commit hook pasa prettier sobre `*.md`
 * y reformatearia las fixtures (tablas GFM, espaciado) rompiendo la igualdad
 * byte a byte — paso en el primer push de fase 2, cazado por CI.
 */

const FIXTURES_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures');

function estructuraSnapshot(tipo: 'capacitacion' | 'relevamiento' | 'otros'): string {
  return readFileSync(join(FIXTURES_DIR, `estructura-${tipo}.txt`), 'utf8');
}

const CONFIGURABLES = [
  { tipo: 'capacitacion', prompt: SYSTEM_PROMPT_CAPACITACION, catalogo: SECCIONES_CAPACITACION },
  { tipo: 'relevamiento', prompt: SYSTEM_PROMPT_RELEVAMIENTO, catalogo: SECCIONES_RELEVAMIENTO },
  { tipo: 'otros', prompt: SYSTEM_PROMPT_OTROS, catalogo: SECCIONES_OTROS },
] as const;

describe('prompts fase 2 · canary de no-drift del bloque Estructura', () => {
  it.each(CONFIGURABLES)(
    '$tipo: el bloque Estructura es byte-identico al snapshot pre-refactor',
    ({ tipo, prompt }) => {
      expect(prompt).toContain(estructuraSnapshot(tipo));
    },
  );

  it('ningun prompt contiene "undefined" (Record de cuerpos incompleto en runtime)', () => {
    for (const { prompt } of CONFIGURABLES) {
      expect(prompt).not.toContain('undefined');
    }
  });

  it('rgrl y accidente conservan su Estructura literal (NO configurables)', () => {
    // La estructura legal de estos tipos no se parametriza — el heading y la
    // primera seccion siguen hardcodeados como prosa.
    expect(SYSTEM_PROMPT_RGRL).toContain('# Estructura del RGRL');
    expect(SYSTEM_PROMPT_RGRL).toContain('## 1. Datos del establecimiento');
    expect(SYSTEM_PROMPT_ACCIDENTE).toContain('# Estructura');
    expect(SYSTEM_PROMPT_ACCIDENTE).toContain('## 1.');
  });
});

describe('prompts fase 2 · ensamblado desde catalogo + regla condicional', () => {
  it.each(CONFIGURABLES)(
    '$tipo: headings numerados en el orden canonico del catalogo',
    ({ prompt, catalogo }) => {
      let cursor = -1;
      catalogo.forEach((s, i) => {
        const heading = `## ${i + 1}. ${s.label}`;
        const idx = prompt.indexOf(heading);
        expect(idx, `falta o esta desordenado: "${heading}"`).toBeGreaterThan(cursor);
        cursor = idx;
      });
    },
  );

  it.each(CONFIGURABLES)(
    '$tipo: regla condicional "Estructura solicitada" presente',
    ({ prompt }) => {
      expect(prompt).toContain('# Estructura solicitada por el consultor (regla condicional)');
      expect(prompt).toContain(
        'Generá SOLO las secciones listadas en ese bloque, en ese orden exacto',
      );
      expect(prompt).toContain('aplican SIEMPRE, también dentro de las secciones personalizadas');
      // El refuerzo fase-1 menciona el bloque nuevo.
      expect(prompt).toContain('"Estructura solicitada"');
    },
  );

  it('otros: la regla de "4 obligatorias" queda suspendida solo con estructura solicitada', () => {
    expect(SYSTEM_PROMPT_OTROS).toContain(
      'La regla de "secciones obligatorias" de arriba aplica únicamente cuando NO hay estructura solicitada',
    );
  });

  it('rgrl y accidente NO tienen regla condicional de estructura (quedan fijos)', () => {
    expect(SYSTEM_PROMPT_RGRL).not.toContain('Estructura solicitada');
    expect(SYSTEM_PROMPT_ACCIDENTE).not.toContain('Estructura solicitada');
  });
});
