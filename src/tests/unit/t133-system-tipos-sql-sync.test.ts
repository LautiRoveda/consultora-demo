/**
 * T-133 · Test-meta anti-drift SQL↔TS de la lista de tipos system-generated.
 *
 * La policy INSERT `calendar_events_insert_own` y el trigger
 * `calendar_events_guard_system_rows` (migración t133_calendar_hardening)
 * hardcodean la lista en SQL; el espejo TS vive en SYSTEM_GENERATED_EVENT_TIPOS
 * (defaults.ts). Si alguien suma un tipo system en un solo lado, este test
 * rompe en CI — la disciplina manual del comentario cruzado no alcanza
 * (lección anti-drift del repo).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SYSTEM_GENERATED_EVENT_TIPOS } from '@/app/(app)/calendario/defaults';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

describe('T-133 · sync SQL↔TS de tipos system-generated', () => {
  it('los sets hardcodeados en la migración t133 == SYSTEM_GENERATED_EVENT_TIPOS', () => {
    const fileName = readdirSync(MIGRATIONS_DIR).find((f) =>
      f.endsWith('_t133_calendar_hardening.sql'),
    );
    expect(fileName, 'migración *_t133_calendar_hardening.sql no encontrada').toBeDefined();

    const sql = readFileSync(join(MIGRATIONS_DIR, fileName!), 'utf8');
    // Matchea `tipo not in ('a', 'b')` (policy INSERT) y `old.tipo in ('a', 'b')`
    // (trigger). Las comparaciones por igualdad de la RPC (`ce.tipo = '...'`)
    // quedan fuera a propósito: son por-rama, no la lista completa.
    const matches = [...sql.matchAll(/(?:tipo\s+not\s+in|old\.tipo\s+in)\s*\(([^)]+)\)/gi)];
    expect(matches.length, 'esperaba al menos policy + trigger').toBeGreaterThanOrEqual(2);

    const expected = [...SYSTEM_GENERATED_EVENT_TIPOS].sort();
    for (const m of matches) {
      const set = [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!).sort();
      expect(set).toEqual(expected);
    }
  });
});
