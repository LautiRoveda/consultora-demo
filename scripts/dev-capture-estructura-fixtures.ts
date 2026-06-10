/**
 * T-138 fase 2 · Captura one-shot de los bloques "# Estructura ..." de los 3
 * prompts configurables (capacitacion / relevamiento / otros) ANTES del
 * refactor a datos. Las fixtures son el canary de no-drift: el prompt
 * re-armado desde el catalogo debe seguir conteniendo estos bytes exactos
 * (prompts-secciones-assembly.test.ts).
 *
 * Correr UNA vez sobre los prompts pre-refactor: `pnpm exec tsx scripts/dev-capture-estructura-fixtures.ts`.
 * Re-correrlo despues del refactor es un no-op si no hay drift.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { SYSTEM_PROMPT_CAPACITACION } from '../src/shared/ai/prompts/capacitacion';
import { SYSTEM_PROMPT_OTROS } from '../src/shared/ai/prompts/otros';
import { SYSTEM_PROMPT_RELEVAMIENTO } from '../src/shared/ai/prompts/relevamiento';

const CASES = [
  {
    tipo: 'capacitacion',
    prompt: SYSTEM_PROMPT_CAPACITACION,
    desde: '# Estructura del informe / constancia de capacitación',
  },
  {
    tipo: 'relevamiento',
    prompt: SYSTEM_PROMPT_RELEVAMIENTO,
    desde: '# Estructura del informe de relevamiento',
  },
  {
    tipo: 'otros',
    prompt: SYSTEM_PROMPT_OTROS,
    desde: '# Estructura mínima del informe genérico',
  },
] as const;

for (const { tipo, prompt, desde } of CASES) {
  const start = prompt.indexOf(desde);
  const end = prompt.indexOf('\n# Output');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`No se pudo recortar el bloque Estructura de ${tipo}`);
  }
  const block = prompt.slice(start, end);
  const out = join(process.cwd(), `src/tests/unit/fixtures/estructura-${tipo}.md`);
  writeFileSync(out, block, 'utf8');
  console.log(`${tipo}: ${block.length} chars -> ${out}`);
}
