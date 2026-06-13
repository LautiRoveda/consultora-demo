/**
 * T-143 · Test-meta anti-drift SQL↔TS del enum `agente_riesgo_tipo`.
 *
 * El enum vive hardcodeado en la migración t143; su espejo TS es `AGENTE_TIPOS`
 * (rar/schema.ts), que alimenta el `z.enum` de validación y el catálogo default.
 * Si alguien suma/saca un tipo en un solo lado, este test rompe en CI — la
 * disciplina manual no alcanza (lección anti-drift del repo, molde t133).
 *
 * Valida consistencia INTERNA (enum SQL == enum TS, y los tipos del catálogo
 * default ∈ enum). NO valida fidelidad legal del 658/96 (eso lo revisa el owner).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { AGENTES_658_DEFAULT } from '@/app/(app)/rar/catalogo-data';
import { AGENTE_TIPOS } from '@/app/(app)/rar/schema';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

describe('T-143 · sync SQL↔TS del enum agente_riesgo_tipo', () => {
  it('el enum SQL agente_riesgo_tipo == AGENTE_TIPOS (TS)', () => {
    const fileName = readdirSync(MIGRATIONS_DIR).find((f) =>
      f.endsWith('_t143_rar_agentes_exposicion.sql'),
    );
    expect(fileName, 'migración *_t143_rar_agentes_exposicion.sql no encontrada').toBeDefined();

    const sql = readFileSync(join(MIGRATIONS_DIR, fileName!), 'utf8');
    const match = sql.match(
      /create\s+type\s+public\.agente_riesgo_tipo\s+as\s+enum\s*\(([^)]+)\)/i,
    );
    expect(match, 'no se encontró el create type del enum').not.toBeNull();

    const sqlValues = [...match![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!).sort();
    const tsValues = [...AGENTE_TIPOS].sort();
    expect(sqlValues).toEqual(tsValues);
  });

  it('todos los agente_tipo del catálogo default ∈ AGENTE_TIPOS', () => {
    const allowed = new Set<string>(AGENTE_TIPOS);
    const offenders = AGENTES_658_DEFAULT.filter((a) => !allowed.has(a.agente_tipo));
    expect(offenders).toEqual([]);
  });

  it('los codigo del catálogo default son únicos (natural key del seed idempotente)', () => {
    const codigos = AGENTES_658_DEFAULT.map((a) => a.codigo);
    expect(new Set(codigos).size).toBe(codigos.length);
  });
});
