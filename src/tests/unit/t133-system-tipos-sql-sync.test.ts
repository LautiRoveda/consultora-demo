/**
 * T-133/T-146 · Test-meta anti-drift SQL↔TS de la lista de tipos system-generated.
 *
 * La policy INSERT `calendar_events_insert_own` y el trigger
 * `calendar_events_guard_system_rows` hardcodean la lista en SQL; el espejo TS
 * vive en SYSTEM_GENERATED_EVENT_TIPOS (defaults.ts). Si alguien suma un tipo
 * system en un solo lado, este test rompe en CI — la disciplina manual del
 * comentario cruzado no alcanza (lección anti-drift del repo).
 *
 * T-146: la policy y el trigger se REDEFINEN en migraciones posteriores (t146
 * sumó `rar_anual`). Por eso ya no leemos solo el archivo t133: escaneamos TODAS
 * las migraciones en orden cronológico y validamos la definición EFECTIVA — la
 * ÚLTIMA redefinición de cada clause es la que la DB tiene activa.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SYSTEM_GENERATED_EVENT_TIPOS } from '@/app/(app)/calendario/defaults';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

/** Extrae los literales `'...'` de un fragmento de lista SQL, ordenados. */
function parseSqlList(fragment: string): string[] {
  return [...fragment.matchAll(/'([^']+)'/g)].map((x) => x[1]!).sort();
}

describe('T-133 · sync SQL↔TS de tipos system-generated', () => {
  it('la definición EFECTIVA (policy + trigger) == SYSTEM_GENERATED_EVENT_TIPOS', () => {
    // Orden lexicográfico de los nombres = orden cronológico (prefijo timestamp).
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    // `tipo not in (...)` = policy INSERT; `old.tipo in (...)` = trigger guard.
    // Las comparaciones por igualdad (`tipo = '...'` de las RPCs) quedan fuera a
    // propósito: son por-rama, no la lista completa. Nos quedamos con el ÚLTIMO
    // match de cada clause a través de todas las migraciones (la efectiva).
    let lastPolicy: string[] | null = null;
    let lastTrigger: string[] | null = null;
    for (const f of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
      for (const m of sql.matchAll(/tipo\s+not\s+in\s*\(([^)]+)\)/gi)) {
        lastPolicy = parseSqlList(m[1]!);
      }
      for (const m of sql.matchAll(/old\.tipo\s+in\s*\(([^)]+)\)/gi)) {
        lastTrigger = parseSqlList(m[1]!);
      }
    }

    const expected = [...SYSTEM_GENERATED_EVENT_TIPOS].sort();
    expect(lastPolicy, 'policy INSERT calendar_events_insert_own no encontrada').toEqual(expected);
    expect(lastTrigger, 'trigger calendar_events_guard_system_rows no encontrado').toEqual(
      expected,
    );
  });
});
